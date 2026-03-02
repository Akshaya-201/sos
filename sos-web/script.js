const HOLD_DURATION = 3000; // ms
const VIOLENCE_API_URL = "http://127.0.0.1:8001/predict"; // adjust if needed

const sosButton = document.getElementById("sos-button");
const categoryButtons = document.querySelectorAll(".category-chip");
const toast = document.getElementById("toast");

const navItems = document.querySelectorAll(".nav-item");
const screens = {
  home: document.getElementById("screen-home"),
  contacts: document.getElementById("screen-contacts"),
  profile: document.getElementById("screen-profile"),
  monitor: document.getElementById("screen-monitor")
};

const contactSearch = document.getElementById("contact-search");
const contactList = document.getElementById("contact-list");
const contactDetail = document.getElementById("contact-detail");
const favoritePills = document.querySelectorAll(".favorite-pill");

const toggleRows = document.querySelectorAll(".toggle-row");

// Monitor DOM elements
const monitorVideo = document.getElementById("monitor-video");
const monitorState = document.getElementById("monitor-state");
const monitorMessage = document.getElementById("monitor-message");
const monitorFooter = document.getElementById("monitor-footer");
const probVideo = document.getElementById("prob-video");
const probAudio = document.getElementById("prob-audio");
const probCombined = document.getElementById("prob-combined");
const monitorBack = document.getElementById("monitor-back");
const monitorRestart = document.getElementById("monitor-restart");
const monitorStop = document.getElementById("monitor-stop");

let holdTimeout = null;
let holdStart = null;
let selectedCategory = null;

let monitorStream = null;
let monitorInterval = null;
let monitorCanvas = null;
let monitorCtx = null;
let monitorActive = false;

// Category selection
categoryButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    categoryButtons.forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    selectedCategory = btn.dataset.category;
  });
});

// Screen navigation
function setActiveScreen(target, highlightNav = true) {
  if (!screens[target]) return;

  if (highlightNav) {
    navItems.forEach((btn) => btn.classList.remove("nav-item--active"));
    navItems.forEach((btn) => {
      if (btn.getAttribute("data-screen") === target) {
        btn.classList.add("nav-item--active");
      }
    });
  }

  Object.values(screens).forEach((el) => el.classList.remove("screen--active"));
  screens[target].classList.add("screen--active");

  if (target !== "monitor" && monitorActive) {
    stopMonitor();
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.getAttribute("data-screen");
    if (!target || !screens[target]) return;
    setActiveScreen(target, true);
  });
});

// SOS long press
function startHold() {
  if (!selectedCategory) {
    showToast("Choose an emergency category first.");
    return;
  }

  if (holdTimeout) return;

  holdStart = performance.now();
  sosButton.classList.add("is-holding");

  holdTimeout = setTimeout(() => {
    completeSOS();
    resetHold();
  }, HOLD_DURATION);

  requestAnimationFrame(updateProgress);
}

function updateProgress(timestamp) {
  if (!holdStart) return;
  const elapsed = timestamp - holdStart;
  const ratio = Math.min(elapsed / HOLD_DURATION, 1);
  const deg = ratio * 360;
  sosButton.style.setProperty("--progress", `${deg}deg`);

  if (ratio < 1 && holdTimeout) {
    requestAnimationFrame(updateProgress);
  }
}

function resetHold() {
  if (holdTimeout) {
    clearTimeout(holdTimeout);
    holdTimeout = null;
  }
  sosButton.classList.remove("is-holding");
  sosButton.style.setProperty("--progress", "0deg");
  holdStart = null;
}

function cancelHold() {
  if (!holdTimeout) return;
  resetHold();
  showToast("Hold cancelled.");
}

function completeSOS() {
  const label =
    selectedCategory?.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) ||
    "Unknown";
  showToast(`SOS sent for: ${label}`);
  openMonitor();
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

["mousedown", "touchstart"].forEach((eventName) => {
  sosButton.addEventListener(
    eventName,
    (event) => {
      event.preventDefault();
      startHold();
    },
    { passive: false }
  );
});

["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((eventName) => {
  sosButton.addEventListener(eventName, () => {
    cancelHold();
  });
});

// Contacts: populate searchable attribute
if (contactList) {
  contactList.querySelectorAll(".contact-row").forEach((row) => {
    const name = row.getAttribute("data-name") || "";
    const phone = row.getAttribute("data-phone") || "";
    row.dataset.search = `${name} ${phone}`.toLowerCase();

    row.addEventListener("click", () => {
      showContactDetail(name, phone);
    });
  });
}

favoritePills.forEach((pill) => {
  pill.addEventListener("click", () => {
    const id = pill.getAttribute("data-contact-id");
    if (!id || !contactList) return;
    const targetRow = contactList.querySelector(
      `.contact-row[data-contact-id="${id}"]`
    );
    if (targetRow) {
      const name = targetRow.getAttribute("data-name") || "";
      const phone = targetRow.getAttribute("data-phone") || "";
      showContactDetail(name, phone);
      targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
});

function showContactDetail(name, phone) {
  if (!contactDetail) return;

  contactDetail.innerHTML = `
    <div class="contact-detail-header">
      <div class="contact-avatar">${name.charAt(0) || "?"}</div>
      <div>
        <div class="contact-detail-name">${name}</div>
        <div class="contact-detail-phone">${phone}</div>
      </div>
    </div>
    <div class="contact-detail-actions">
      <button class="contact-detail-button" type="button">Call</button>
      <button class="contact-detail-button" type="button">Message</button>
    </div>
  `;
}

if (contactSearch && contactList) {
  contactSearch.addEventListener("input", () => {
    const value = contactSearch.value.trim().toLowerCase();
    contactList.querySelectorAll(".contact-row").forEach((row) => {
      const haystack = row.dataset.search || "";
      row.style.display = haystack.includes(value) ? "flex" : "none";
    });
  });
}

// Profile toggles
toggleRows.forEach((row) => {
  row.addEventListener("click", () => {
    row.classList.toggle("is-on");
  });
});

// Monitor logic
function openMonitor() {
  setActiveScreen("monitor", false);
  startMonitor();
}

async function startMonitor() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      monitorMessage.textContent = "Camera not supported in this browser.";
      monitorState.textContent = "ERROR";
      return;
    }

    stopMonitor();

    monitorState.textContent = "CONNECTING";
    monitorMessage.textContent = "Requesting access to your camera...";

    monitorStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true
    });

    if (monitorVideo) {
      monitorVideo.srcObject = monitorStream;
      await monitorVideo.play().catch(() => {});
    }

    monitorActive = true;
    monitorState.textContent = "LIVE";
    monitorMessage.textContent =
      "Monitoring audio and video for signs of violence...";

    if (!monitorCanvas) {
      monitorCanvas = document.createElement("canvas");
      monitorCtx = monitorCanvas.getContext("2d");
    }

    monitorInterval = window.setInterval(captureAndPredictFrame, 2000);
  } catch (error) {
    console.error("Failed to start monitor", error);
    monitorState.textContent = "ERROR";
    monitorMessage.textContent =
      "Could not access camera. Check permissions and try again.";
  }
}

function stopMonitor() {
  monitorActive = false;
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }

  if (monitorStream) {
    monitorStream.getTracks().forEach((t) => t.stop());
    monitorStream = null;
  }

  if (monitorVideo) {
    monitorVideo.srcObject = null;
  }

  if (monitorState) {
    monitorState.textContent = "IDLE";
  }
}

async function captureAndPredictFrame() {
  if (!monitorActive || !monitorVideo || monitorVideo.readyState < 2) return;
  if (!monitorCanvas || !monitorCtx) return;

  const width = monitorVideo.videoWidth || 320;
  const height = monitorVideo.videoHeight || 240;
  monitorCanvas.width = width;
  monitorCanvas.height = height;
  monitorCtx.drawImage(monitorVideo, 0, 0, width, height);

  // For now: random demo probabilities between 1–100.
  const videoProb = Math.floor(Math.random() * 100) + 1;
  const audioProb = Math.floor(Math.random() * 100) + 1;
  const combinedProb = (videoProb + audioProb) / 2;

  if (probVideo) probVideo.textContent = `${videoProb}%`;
  if (probAudio) probAudio.textContent = `${audioProb}%`;
  if (probCombined) probCombined.textContent = `${combinedProb.toFixed(0)}%`;

  const detected = combinedProb >= 70;
  if (detected) {
    monitorMessage.textContent =
      "Violence detected. Preparing emergency evidence package...";
    monitorFooter.textContent =
      "Sending incident evidence to emergency contacts...";
    monitorState.textContent = "ALERT";
  } else {
    monitorMessage.textContent =
      "No incident detected. Monitoring will continue...";
    monitorFooter.textContent = "Source: sos · Monitoring.";
    monitorState.textContent = "LIVE";
  }
}

if (monitorBack) {
  monitorBack.addEventListener("click", () => {
    stopMonitor();
    setActiveScreen("home", true);
  });
}

if (monitorRestart) {
  monitorRestart.addEventListener("click", () => {
    startMonitor();
  });
}

if (monitorStop) {
  monitorStop.addEventListener("click", () => {
    stopMonitor();
  });
}

