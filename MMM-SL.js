Module.register("MMM-SL", {
  defaults: {
    debug: false,
    header: "SL Departures",
    apiBase: "https://transport.integration.sl.se/v1/sites",
    timewindow: 10,
    updateInterval: 2,
    countdownInterval: 1,
    scheduledDisplayLimits: {
        "Emilie": 2, // Example: Show at most 2 departures for the "Emily" line
        "Sjöstadsbåtarna": 2 // Example: Show at most 3 departures for the "Sjöstadsbåtarna" line
    },
    siteids: [],
    convertTimeToMinutes: true,
    showRecentlyPassed: false,
    showLastUpdatedAlways: true,
    lastUpdatedInTitle: true,
    iconTable: {
      "BUS": "fa-bus",
      "SHIP": "fa-ship",
      "METRO": "fa-subway",
      "TRAM": "fa-train",
      "TRAIN": "fa-train",
    },
  },

  start: function () {
    Log.info(this.name + " starting...");
    this.loaded = false;
    this.lastUpdated = null;
    this.departureData = {};
    this.scheduleData = {};
    this.loadScheduleData();
    this.scheduleUpdates();
    this.updateDepartures();
  },

  getStyles: function () {
    return ["font-awesome.css", this.file("css/mmm-sl.css")];
  },

  getHeader: function () {
    let dotColor = "red"; // Default to red for outdated data
    if (this.lastUpdated) {
        let lastUpdateMoment = moment(this.lastUpdated);
        let now = moment();
        let diffMinutes = now.diff(lastUpdateMoment, "minutes");
        if (diffMinutes <= 5) {
            dotColor = "green"; // Set to green if data is fresh
        }
    }
    return `
        ${this.data.header}
        <span style="color: ${dotColor}; font-size: 0.8em;">
            <i class="fa fa-circle"></i>
        </span>`;
  },


  getDom: function () {
    let wrapper = document.createElement("div");
    if (!this.loaded) {
      wrapper.innerHTML = "Loading...";
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    let table = document.createElement("table");
    table.className = "small";

    // Combine real-time and scheduled stops (including those with only scheduled data)
    let allStopNames = new Set(Object.keys(this.departureData)); // Start with real-time stops
    this.scheduleData.schedules.forEach(schedule => allStopNames.add(schedule.stop_name)); // Add scheduled stops

    // Sort stop points alphabetically
    let sortedStopPoints = Array.from(allStopNames).sort();

    sortedStopPoints.forEach(stopPointName => {
      let stopData = this.departureData[stopPointName] || { departures: [] }; // Handle cases with no real-time data

      let scheduledDepartures = [];
      // Get scheduled departures for the current stop from schedule.json
      const schedulesForStop = this.scheduleData.schedules.filter(schedule => schedule.stop_name === stopPointName);

      schedulesForStop.forEach(schedule => {
        scheduledDepartures = [...scheduledDepartures, ...this.getScheduledDepartures(schedule)];
      });

      // Combine real-time and scheduled departures
      let combinedDepartures = [...stopData.departures, ...scheduledDepartures];

      // Sort combined departures by time
      combinedDepartures.sort((a, b) => {
        let timeA = moment().add(a.countdown.split(" ")[0], "minutes");
        let timeB = moment().add(b.countdown.split(" ")[0], "minutes");
        return timeA.diff(timeB);
      });

      // Add stop header
      let headerRow = document.createElement("tr");
      let headerCell = document.createElement("td");
      headerCell.colSpan = 4;
      headerCell.innerHTML = `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<i class="fa fa-location-dot"></i>&nbsp;&nbsp;${stopPointName}`;
      headerCell.className = "bright align-left";
      headerRow.appendChild(headerCell);
      table.appendChild(headerRow);

      // Display the combined list
      combinedDepartures.slice(0, stopData.displayCount).forEach(departure => {
        let row = document.createElement("tr");

        let iconCell = document.createElement("td");
        let icon = document.createElement("span");
        icon.className = `fa ${this.config.iconTable[departure.transport_mode] || "fa-question"}`;
        iconCell.appendChild(icon);
        row.appendChild(iconCell);

        let lineCell = document.createElement("td");
        lineCell.innerHTML = departure.line;
        lineCell.className = "align-left bright";
        row.appendChild(lineCell);

        let destinationCell = document.createElement("td");
        destinationCell.innerHTML = departure.destination;
        destinationCell.className = "align-right";
        row.appendChild(destinationCell);

        let timeCell = document.createElement("td");
        timeCell.innerHTML = departure.countdown;
        timeCell.className = "align-right";
        row.appendChild(timeCell);

        table.appendChild(row);
      });
    });

    return table;
  },

  loadScheduleData: function () {
    fetch(this.file("assets/schedule.json"))
      .then(response => response.json())
      .then(data => {
        Log.info("MMM-SL: Schedule data loaded", data); // Debug log
        this.scheduleData = data;
        this.updateDom();
      })
      .catch(error => {
        Log.error("MMM-SL: Error loading schedule data", error);
      });
  },

  getDayName: function (day) {
    const daysMap = {
      "Monday": 1,
      "Tuesday": 2,
      "Wednesday": 3,
      "Thursday": 4,
      "Friday": 5,
      "Saturday": 6,
      "Sunday": 0,
      "Monday-Friday": [1, 2, 3, 4, 5],
      "Saturday-Sunday": [6, 0]
    };
    return daysMap[day];
  },

  getScheduledDepartures: function (schedule) {
    let scheduledDepartures = [];
    const now = moment();
    const todayDay = now.day();

    // Get the maximum limit for this lineid from the config
    const maxDepartures = this.config.scheduledDisplayLimits[schedule.lineid] || Infinity;

    // Iterate over each range in schedule.days
    Object.keys(schedule.days).forEach(dayRange => {
        const days = this.getDayName(dayRange);

        // Check if the current day is part of the range
        if (Array.isArray(days) ? days.includes(todayDay) : todayDay === days) {
            // Iterate over each time slot for this day range
            schedule.days[dayRange].forEach(timeSlot => {
                timeSlot.minutes.forEach(minute => {
                    let departureTime = moment().hour(timeSlot.hour).minute(minute);
                    if (departureTime.isAfter(now)) {
                        let countdown = departureTime.diff(now, "minutes");

                        // Determine how to display the departure time
                        let displayTime;
                        if (countdown > 59) {
                            displayTime = departureTime.format("HH:mm"); // Fixed time format
                        } else {
                            displayTime = countdown > 0 ? `${countdown} min` : "Nu"; // Countdown format
                        }

                        scheduledDepartures.push({
                            line: `${schedule.lineid}`,
                            destination: schedule.destination,
                            countdown: displayTime,
                            transport_mode: schedule.transport_type
                        });
                    }
                });
            });
        }
    });

    return scheduledDepartures.slice(0, maxDepartures);
},


  scheduleUpdates: function () {
    setInterval(() => this.updateDepartures(), this.config.updateInterval * 60 * 1000);
    setInterval(() => this.updateCountdowns(), this.config.countdownInterval * 60 * 1000);
  },

  updateDepartures: function () {
    this.loaded = false;
    this.departureData = {};
    this.config.siteids.forEach(site => {
      let url = `${this.config.apiBase}/${site.id}/departures?transport=${site.type}&direction=${site.direction}&forecast=${site.timewindow}`;
      this.fetchData(url, site);
    });
  },

  fetchData: function (url, siteConfig) {
    fetch(url)
      .then(response => response.json())
      .then(data => {
        this.processDepartures(data, siteConfig);
        this.lastUpdated = moment().format();
        this.loaded = true;
        this.updateDom();
      })
      .catch(error => {
        Log.error("MMM-SL: Error fetching data from API", error);
      });
  },

  processDepartures: function (data, siteConfig) {
    data.departures.forEach(departure => {
      let stopPointName = departure.stop_point.name;
      if (!this.departureData[stopPointName]) {
        this.departureData[stopPointName] = {
          departures: [],
          displayCount: siteConfig.displayCount || 5, // Default to 5 if not specified
        };
      }

      let expectedTime = moment(departure.expected);
      let countdown = Math.max(0, expectedTime.diff(moment(), "minutes"));
      this.departureData[stopPointName].departures.push({
        line: departure.line.designation,
        destination: departure.destination,
        countdown: countdown > 0 ? `${countdown} min` : "Nu",
        transport_mode: departure.line.transport_mode,
      });
    });
  },

  updateCountdowns: function () {
    for (let stopPoint in this.departureData) {
      this.departureData[stopPoint].departures.forEach(departure => {
        let currentCountdown = parseInt(departure.countdown.replace(" min", ""));
        if (!isNaN(currentCountdown)) {
          departure.countdown = currentCountdown > 1 ? `${currentCountdown - 1} min` : "Nu";
        }
      });
    }
    this.updateDom();
  },
});
