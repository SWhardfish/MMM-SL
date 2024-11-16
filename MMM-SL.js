Module.register("MMM-SL", {
  defaults: {
    debug: false,
    header: "SL Departures",
    apiBase: "https://transport.integration.sl.se/v1/sites",
    timewindow: 10,
    updateInterval: 2,
    countdownInterval: 1,
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
    this.scheduleUpdates();
    this.updateDepartures();
  },

  getStyles: function () {
    return ["font-awesome.css", this.file("css/mmm-sl.css")];
  },

  getHeader: function () {
    if (this.config.showLastUpdatedAlways && this.config.lastUpdatedInTitle) {
      let time = this.lastUpdated ? moment(this.lastUpdated).format("HH:mm:ss") : "Updating...";
      return `<span class='bright'>${this.data.header}</span> <span class='dimmed'><i class='fa fa-refresh'></i> ${time}</span>`;
    }
    return `<span class='bright'>${this.data.header}</span>`;
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

    // Sort stop points alphabetically
    let sortedStopPoints = Object.keys(this.departureData).sort();

    sortedStopPoints.forEach(stopPointName => {
      let stopData = this.departureData[stopPointName];

      // Add header row for the stop point
      let headerRow = document.createElement("tr");
      let headerCell = document.createElement("td");
      headerCell.colSpan = 4;
      headerCell.innerHTML = stopPointName;
      headerCell.className = "bright align-right";
      headerRow.appendChild(headerCell);
      table.appendChild(headerRow);

      // Limit the number of departures displayed based on displayCount
      stopData.departures.slice(0, stopData.displayCount).forEach(departure => {
        let row = document.createElement("tr");

        let iconCell = document.createElement("td");
        let icon = document.createElement("span");
        icon.className = `fa ${this.config.iconTable[departure.transport_mode] || "fa-question"}`;
        iconCell.appendChild(icon);
        row.appendChild(iconCell);

        let lineCell = document.createElement("td");
        lineCell.innerHTML = departure.line;
        lineCell.className = "align-right bright";
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
