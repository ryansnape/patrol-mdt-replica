const calls = [
  {
    id: "C-2481",
    priority: 1,
    type: "Disturbance",
    address: "1400 Warren Ave",
    cross: "Warren Ave / 9th Street",
    time: "18:42",
    assigned: true,
    status: "Dispatched",
    caller: "Store manager",
    units: "2A-17, 2A-22",
    narrative:
      "Caller reports a verbal argument in the parking lot. No weapons seen. Two subjects near a dark sedan. Simulation data only.",
    offset: [0.006, -0.004],
  },
  {
    id: "C-2479",
    priority: 2,
    type: "Traffic Hazard",
    address: "Harbor Rd near Cedar Pkwy",
    cross: "Harbor Rd / Cedar Pkwy",
    time: "18:35",
    assigned: false,
    status: "Pending",
    caller: "Road crew",
    units: "2B-05",
    narrative: "Lane obstruction from construction materials. Public works notified.",
    offset: [-0.004, 0.006],
  },
  {
    id: "C-2476",
    priority: 3,
    type: "Welfare Check",
    address: "880 Lakeview Ct",
    cross: "Lakeview Ct / Mill St",
    time: "18:21",
    assigned: false,
    status: "Holding",
    caller: "Neighbor",
    units: "Unassigned",
    narrative: "Neighbor requests check after not seeing resident for several days.",
    offset: [0.003, 0.008],
  },
  {
    id: "C-2472",
    priority: 2,
    type: "Alarm",
    address: "510 Northgate Plaza",
    cross: "Northgate Plaza / Service Dr",
    time: "18:08",
    assigned: true,
    status: "En Route",
    caller: "Alarm company",
    units: "2A-11",
    narrative: "Commercial motion alarm, rear entry zone. Keyholder en route.",
    offset: [-0.006, -0.005],
  },
];

const lookupRecords = {
  plate: {
    "7KQD219": [
      ["Plate", "7KQD219"],
      ["Vehicle", "2019 gray sedan"],
      ["Registered", "Avery Morgan"],
      ["Status", "Valid registration"],
    ],
    "4MTR882": [
      ["Plate", "4MTR882"],
      ["Vehicle", "2021 white van"],
      ["Registered", "Northpoint Supply"],
      ["Status", "Expired registration"],
    ],
  },
  person: {
    "AVERY MORGAN": [
      ["Name", "Avery Morgan"],
      ["DOB", "1988-04-16"],
      ["License", "Valid"],
      ["Notes", "No synthetic wants"],
    ],
  },
  address: {
    "1400 WARREN AVE": [
      ["Address", "1400 Warren Ave"],
      ["Premise", "Retail parking lot"],
      ["History", "2 calls in 30 days"],
      ["Caution", "Poor lighting"],
    ],
  },
};

let selectedCallId = null;
let activeFilter = "all";
let activeLookup = "plate";
let sirenMode = "off";
let hornRingEnabled = false;
let radioRebroadcastEnabled = false;
let audioContext = null;
let sirenOscillator = null;
let sirenGain = null;
let sirenTimer = null;
let audioUnlocked = false;
let mdtMap = null;
let unitMarker = null;
let routeLine = null;
let callMarkers = [];
let unitPosition = [34.0522, -118.2437];

const $ = (selector) => document.querySelector(selector);

const callList = $("#callList");
const queueCount = $("#queueCount");
const incidentDetail = $("#incidentDetail");
const caseNumber = $("#caseNumber");
const selectedLocation = $("#selectedLocation");
const mapSource = $("#mapSource");
const unitStatus = $("#unitStatus");
const clock = $("#clock");
const log = $("#log");
const lookupForm = $("#lookupForm");
const lookupQuery = $("#lookupQuery");
const lookupResult = $("#lookupResult");
const lightbar = $("#lightbar");
const vehicleStage = $("#vehicleStage");
const lightbarState = $("#lightbarState");
const sirenState = $("#sirenState");
const sirenKnob = $("#sirenKnob");
const sirenVolume = $("#sirenVolume");
const patternName = $("#patternName");
const hornRingState = $("#hornRingState");
const radioState = $("#radioState");
const advisorBar = $("#advisorBar");
const advisorState = $("#advisorState");

function priorityLabel(priority) {
  return `P${priority}`;
}

function labelize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function visibleCalls() {
  if (activeFilter === "priority") return calls.filter((call) => call.priority <= 2);
  if (activeFilter === "assigned") return calls.filter((call) => call.assigned);
  return calls;
}

function renderCalls() {
  const visible = visibleCalls();
  queueCount.textContent = `${visible.length} active`;
  callList.innerHTML = visible
    .map(
      (call) => `
        <button class="call-card priority-${call.priority} ${call.id === selectedCallId ? "active" : ""}" data-call-id="${call.id}">
          <span class="call-top">
            <span class="call-type">${call.type}</span>
            <span class="badge p${call.priority}">${priorityLabel(call.priority)}</span>
          </span>
          <p>${call.address}</p>
          <span class="call-meta">
            <span>${call.id}</span>
            <span>${call.time}</span>
            <span>${call.status}</span>
          </span>
        </button>
      `,
    )
    .join("");
}

function detailBlock(label, value) {
  return `<div class="detail-value"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderDetail(call) {
  if (!call) {
    caseNumber.textContent = "Select";
    selectedLocation.textContent = "No selection";
    incidentDetail.innerHTML = `<div class="narrative">Select a CAD entry or map marker.</div>`;
    return;
  }

  caseNumber.textContent = call.id;
  selectedLocation.textContent = call.cross;
  incidentDetail.innerHTML = `
    ${detailBlock("Type", call.type)}
    ${detailBlock("Priority", priorityLabel(call.priority))}
    ${detailBlock("Status", call.status)}
    ${detailBlock("Caller", call.caller)}
    ${detailBlock("Units", call.units)}
    ${detailBlock("Location", call.address)}
    <div class="narrative">${call.narrative}</div>
  `;
}

function selectCall(id) {
  const call = calls.find((item) => item.id === id);
  if (!call) return;
  selectedCallId = id;
  renderCalls();
  renderDetail(call);
  focusCallOnMap(call);
  writeLog(`OPEN ${id}`, `${call.type} at ${call.address}`);
}

function setView(view) {
  const normalized = view === "cad" || view === "map" || view === "lookup" ? view : "cad";
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.id === "cadScreen");
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === normalized);
  });
  writeLog("VIEW", `${normalized.toUpperCase()} DISPLAY SELECTED`);
}

function setStatus(status) {
  unitStatus.textContent = status;
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === status);
  });
  writeLog("STATUS", `2A-17 ${status.toUpperCase()}`);
}

function initMap() {
  if (!window.L) {
    selectedLocation.textContent = "Map library unavailable";
    mapSource.textContent = "Map offline";
    writeLog("MAP", "LEAFLET UNAVAILABLE");
    return;
  }

  mdtMap = L.map("mdtMap", {
    zoomControl: false,
    attributionControl: false,
  }).setView(unitPosition, 14);

  L.control.zoom({ position: "bottomright" }).addTo(mdtMap);
  L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(mdtMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mdtMap);

  renderMapMarkers();
  requestUnitLocation(false);
}

function requestUnitLocation(userRequested) {
  if (!navigator.geolocation) {
    setMapPosition(unitPosition, "LA fallback", "Browser location unavailable");
    return;
  }

  if (userRequested) {
    mapSource.textContent = "Requesting location...";
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = [position.coords.latitude, position.coords.longitude];
      setMapPosition(coords, "Browser location", "Unit GPS from browser");
    },
    () => {
      setMapPosition(unitPosition, "LA fallback", "Location permission denied");
    },
    { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
  );
}

function setMapPosition(coords, source, message) {
  unitPosition = coords;
  mapSource.textContent = source;
  selectedLocation.textContent = message;
  renderMapMarkers();
  if (mdtMap) {
    mdtMap.setView(unitPosition, source === "Browser location" ? 15 : 13);
  }
  writeLog("GPS", message.toUpperCase());
}

function callLatLng(call) {
  return [unitPosition[0] + call.offset[0], unitPosition[1] + call.offset[1]];
}

function renderMapMarkers() {
  if (!mdtMap || !window.L) return;

  if (!unitMarker) {
    unitMarker = L.marker(unitPosition, {
      title: "2A-17",
      icon: L.divIcon({
        className: "leaflet-unit-marker",
        html: "2A-17",
        iconSize: [48, 28],
        iconAnchor: [24, 14],
      }),
    }).addTo(mdtMap);
  } else {
    unitMarker.setLatLng(unitPosition);
  }

  callMarkers.forEach((marker) => marker.remove());
  callMarkers = calls.map((call) => {
    const marker = L.marker(callLatLng(call), {
      title: call.id,
      icon: L.divIcon({
        className: `leaflet-call-marker priority-${call.priority}`,
        html: priorityLabel(call.priority),
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
    }).addTo(mdtMap);
    marker.on("click", () => selectCall(call.id));
    return marker;
  });
}

function focusCallOnMap(call) {
  if (!mdtMap || !window.L) return;
  const destination = callLatLng(call);
  const bounds = L.latLngBounds([unitPosition, destination]).pad(0.45);
  mdtMap.fitBounds(bounds, { animate: true, maxZoom: 15 });
  if (routeLine) routeLine.remove();
  routeLine = L.polyline([unitPosition, destination], {
    color: "#28c9bc",
    weight: 3,
    opacity: 0.85,
    dashArray: "6 6",
  }).addTo(mdtMap);
}

function setLightMode(mode) {
  const normalized = ["off", "cruise", "response", "pursuit", "takedown", "alley"].includes(mode)
    ? mode
    : "off";
  lightbar.className = `lightbar ${normalized === "off" ? "" : normalized}`.trim();
  vehicleStage.className = `car-preview ${normalized === "off" ? "" : normalized}`.trim();
  lightbarState.textContent = labelize(normalized);
  patternName.textContent = labelize(normalized);
  document.querySelectorAll("[data-light-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.lightMode === normalized);
  });
  writeLog("LIGHTS", `${normalized.toUpperCase()} PATTERN`);
}

function setSlideStage(stage) {
  const stageMode = {
    0: "off",
    1: "cruise",
    2: "response",
    3: "pursuit",
  }[Number(stage)];
  document.querySelectorAll("[data-slide-stage]").forEach((button) => {
    button.classList.toggle("active", button.dataset.slideStage === String(stage));
  });
  setLightMode(stageMode);
  writeLog("SLIDE", `POSITION ${stage}`);
}

function setAdvisorMode(mode) {
  const normalized = ["off", "left", "right", "split", "warn", "dim"].includes(mode) ? mode : "off";
  advisorBar.className = `advisor-bar ${normalized === "off" ? "" : normalized}`.trim();
  advisorState.textContent = labelize(normalized);
  document.querySelectorAll("[data-advisor]").forEach((button) => {
    button.classList.toggle("active", button.dataset.advisor === normalized);
  });
  writeLog("ADVISOR", `${normalized.toUpperCase()} MODE`);
}

function toggleUtility(name) {
  if (name === "hornRing") {
    hornRingEnabled = !hornRingEnabled;
    hornRingState.textContent = hornRingEnabled ? "Siren" : "Normal";
    document.querySelector("[data-toggle='hornRing']").classList.toggle("active", hornRingEnabled);
    writeLog("HORN RING", hornRingEnabled ? "TRANSFER TO SIREN" : "NORMAL VEHICLE HORN");
    return;
  }

  if (name === "radioRebroadcast") {
    radioRebroadcastEnabled = !radioRebroadcastEnabled;
    radioState.textContent = radioRebroadcastEnabled ? "Rebroadcast" : "Normal";
    document
      .querySelector("[data-toggle='radioRebroadcast']")
      .classList.toggle("active", radioRebroadcastEnabled);
    if (radioRebroadcastEnabled) playRadioChirp();
    writeLog("RADIO", radioRebroadcastEnabled ? "REBROADCAST ENABLED" : "REBROADCAST OFF");
  }
}

async function ensureAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    writeLog("AUDIO", "WEB AUDIO NOT SUPPORTED");
    return false;
  }

  if (!audioContext) {
    audioContext = new AudioCtor();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (!audioUnlocked) {
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
    audioUnlocked = true;
  }

  return audioContext.state === "running";
}

function stopSiren() {
  if (sirenTimer) clearInterval(sirenTimer);
  sirenTimer = null;
  if (sirenOscillator) {
    try {
      sirenOscillator.stop();
    } catch {
      // Already stopped.
    }
    sirenOscillator.disconnect();
  }
  if (sirenGain) sirenGain.disconnect();
  sirenOscillator = null;
  sirenGain = null;
}

async function setSirenMode(mode) {
  const normalized = ["off", "wail", "yelp", "piercer", "priority", "manual"].includes(mode)
    ? mode
    : "off";
  stopSiren();
  sirenMode = normalized;
  document.querySelectorAll("[data-siren]").forEach((button) => {
    button.classList.toggle("active", button.dataset.siren === normalized);
  });
  sirenState.textContent = normalized === "off" ? "Muted" : labelize(normalized);
  sirenKnob.textContent = normalized.toUpperCase();

  if (normalized === "off") {
    writeLog("SIREN", "MUTED");
    return;
  }

  const ready = await ensureAudio();
  if (!ready) {
    writeLog("AUDIO", "TAP AGAIN TO ENABLE AUDIO");
    return;
  }
  startLoopingSiren(normalized);
  writeLog("SIREN", `${normalized.toUpperCase()} TONE ACTIVE`);
}

function startLoopingSiren(mode) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = mode === "piercer" || mode === "priority" ? "square" : "sawtooth";
  gain.gain.value = Number(sirenVolume.value);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();

  sirenOscillator = oscillator;
  sirenGain = gain;

  const started = audioContext.currentTime;
  const ranges = {
    wail: { low: 430, high: 920, cycle: 3.2 },
    yelp: { low: 610, high: 1180, cycle: 0.72 },
    piercer: { low: 760, high: 1450, cycle: 0.22 },
    priority: { low: 540, high: 1320, cycle: 0.46 },
    manual: { low: 390, high: 1020, cycle: 1.35 },
  };
  const range = ranges[mode];

  sirenTimer = setInterval(() => {
    const elapsed = audioContext.currentTime - started;
    const phase = (elapsed % range.cycle) / range.cycle;
    const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const frequency = range.low + (range.high - range.low) * triangle;
    oscillator.frequency.setTargetAtTime(frequency, audioContext.currentTime, 0.035);
    gain.gain.setTargetAtTime(Number(sirenVolume.value), audioContext.currentTime, 0.05);
  }, 35);
}

async function playHorn() {
  const ready = await ensureAudio();
  if (!ready) {
    writeLog("AUDIO", "TAP AGAIN TO ENABLE AUDIO");
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 240;
  gain.gain.value = Number(sirenVolume.value) * 1.15;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.55);
}

async function playRadioChirp() {
  const ready = await ensureAudio();
  if (!ready) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 880;
  gain.gain.value = Number(sirenVolume.value) * 0.45;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.frequency.exponentialRampToValueAtTime(420, audioContext.currentTime + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
  oscillator.stop(audioContext.currentTime + 0.2);
}

function runLookup() {
  const key = lookupQuery.value.trim().toUpperCase();
  const record = lookupRecords[activeLookup][key];
  if (!record) {
    lookupResult.innerHTML = `<p>No synthetic ${activeLookup} record matched.</p>`;
    writeLog("LOOKUP", `${activeLookup.toUpperCase()} ${key || "EMPTY"} NO MATCH`);
    return;
  }

  lookupResult.innerHTML = record
    .map(([label, value]) => `<div class="result-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
  writeLog("LOOKUP", `${activeLookup.toUpperCase()} ${key} RETURNED`);
}

function handleCommand(text) {
  const command = text.trim().toLowerCase();
  if (!command) return;
  if (command.startsWith("call ")) return selectCall(command.replace("call ", "").toUpperCase());
  if (command.startsWith("status ")) return setStatus(labelize(command.replace("status ", "")));
  if (command.startsWith("lights ")) return setLightMode(command.replace("lights ", ""));
  if (command.startsWith("siren ")) return setSirenMode(command.replace("siren ", ""));
  if (command === "clear") {
    selectedCallId = null;
    renderCalls();
    renderDetail(null);
    writeLog("CLEAR", "SCREEN RESET");
    return;
  }
  writeLog("CMD", `${text.trim().toUpperCase()} ACKNOWLEDGED`);
}

function writeLog(code, message) {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<span>${new Date().toLocaleTimeString([], { hour12: false })}</span><span>${code} - ${message}</span>`;
  log.prepend(row);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return setView(viewButton.dataset.view);

  const panicButton = event.target.closest("[data-panic]");
  if (panicButton) {
    setStatus("Emergency");
    setSlideStage(3);
    setSirenMode("yelp");
    writeLog("EMERG", "EMERGENCY BUTTON PRESSED IN SIMULATION");
    return;
  }

  const callButton = event.target.closest("[data-call-id]");
  if (callButton) return selectCall(callButton.dataset.callId);

  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    activeFilter = filterButton.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.classList.toggle("active", button === filterButton);
    });
    renderCalls();
    return;
  }

  const lookupButton = event.target.closest("[data-lookup]");
  if (lookupButton) {
    activeLookup = lookupButton.dataset.lookup;
    document.querySelectorAll("[data-lookup]").forEach((button) => {
      button.classList.toggle("active", button === lookupButton);
    });
    lookupQuery.value =
      activeLookup === "plate" ? "7KQD219" : activeLookup === "person" ? "Avery Morgan" : "1400 Warren Ave";
    runLookup();
    return;
  }

  const statusButton = event.target.closest("[data-status]");
  if (statusButton) return setStatus(statusButton.dataset.status);

  const locateButton = event.target.closest("[data-locate]");
  if (locateButton) return requestUnitLocation(true);

  const slideButton = event.target.closest("[data-slide-stage]");
  if (slideButton) return setSlideStage(slideButton.dataset.slideStage);

  const lightButton = event.target.closest("[data-light-mode]");
  if (lightButton) return setLightMode(lightButton.dataset.lightMode);

  const sirenButton = event.target.closest("[data-siren]");
  if (sirenButton) {
    setSirenMode(sirenButton.dataset.siren);
    return;
  }

  const advisorButton = event.target.closest("[data-advisor]");
  if (advisorButton) return setAdvisorMode(advisorButton.dataset.advisor);

  const utilityButton = event.target.closest("[data-toggle]");
  if (utilityButton) return toggleUtility(utilityButton.dataset.toggle);

  const momentaryButton = event.target.closest("[data-momentary]");
  if (momentaryButton) {
    playHorn();
    writeLog("AIR HORN", "MOMENTARY TONE");
  }
});

sirenVolume.addEventListener("input", () => {
  if (sirenGain) {
    sirenGain.gain.setTargetAtTime(Number(sirenVolume.value), audioContext.currentTime, 0.03);
  }
});

lookupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runLookup();
});

$("#commandForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#commandInput");
  handleCommand(input.value);
  input.value = "";
});

function tickClock() {
  clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
}

renderCalls();
renderDetail(null);
runLookup();
initMap();
setView("cad");
setLightMode("off");
sirenState.textContent = "Muted";
sirenKnob.textContent = "OFF";
setAdvisorMode("off");
writeLog("LOGIN", "LA METRO PATROL MDT READY");
tickClock();
setInterval(tickClock, 1000);
