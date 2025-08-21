// ======= CONFIG =======
const ENDPOINT_URL =
  "https://script.google.com/macros/s/AKfycbzt8i-I_IgqnsT9CDzR0DR28R9wnMxsV1xQhEMil1pUA5n2vLX2ThDXkbM5vVyiGKto/exec";
const SHARED_SECRET = "CHANGE_ME_SHARED_SECRET"; // must match Code.gs

// ======= Utilities =======
const $ = (sel) => document.querySelector(sel);
const uid = () =>
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
    ).toString(16)
  );

function setNetStatus() {
  const net = $("#net");
  if (navigator.onLine) {
    net.className = "status online";
    net.textContent = "Online ✓";
  } else {
    net.className = "status offline";
    net.textContent = "Offline";
  }
}

function toast(msg, ms = 3000) {
  const el = $("#toast");
  el.textContent = msg;
  if (ms) setTimeout(() => (el.textContent = ""), ms);
}

// ======= IndexedDB (tiny helper) =======
const DB_NAME = "offline-form-db";
const STORE = "queue";

function withDB() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function addToQueue(payload) {
  const db = await withDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    // 🔑 Ensure IndexedDB generates the ID
    const cleanPayload = { ...payload };
    delete cleanPayload.id;

    store.add(cleanPayload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllQueued() {
  const db = await withDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function clearByIds(ids) {
  const db = await withDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateQueueCount() {
  const items = await getAllQueued();
  document.querySelector("#qcount").textContent = items.length;
}

// ======= Sync logic =======
async function sendOne(entry) {
  // Use URL-encoded form to reduce chances of CORS preflight
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(entry)) form.append(k, v);

  const resp = await fetch(ENDPOINT_URL, { method: "POST", body: form });

  // Apps Script returns JSON; don’t depend on status code here
  let ok = false;
  try {
    const data = await resp.json();
    ok = !!data.ok;
  } catch (_) {
    /* keep queued */
  }
  return ok;
}

async function syncAll() {
  const items = await getAllQueued();
  if (!items.length) {
    toast("Nothing to sync.");
    return;
  }

  let successIds = [];
  for (const item of items) {
    try {
      const ok = await sendOne(item);
      if (ok) successIds.push(item.id);
    } catch (err) {
      /* keep queued */
    }
  }

  if (successIds.length) {
    await clearByIds(successIds);
    await updateQueueCount();
    toast(`Synced ${successIds.length}/${items.length} item(s).`);
  } else {
    toast("Sync failed – will retry later.");
  }
}

// ======= Tablet niceties: Wake Lock & Orientation =======
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () =>
        console.log("Wake Lock released")
      );
      toast("Screen will stay awake.");
    } else {
      toast("Wake Lock not supported on this browser.");
    }
  } catch (e) {
    console.warn("WakeLock error", e);
  }
}

async function lockPortrait() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("portrait");
      toast("Orientation locked to portrait.");
    } else {
      toast("Orientation lock not supported here.");
    }
  } catch (e) {
    toast("Could not lock orientation.");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // On resume, try to sync and re-acquire wakelock if needed (iOS lacks Background Sync)
    syncAll();
    if (wakeLock) requestWakeLock();
  }
});

// ======= Boot =======
window.addEventListener("load", async () => {
  setNetStatus();
  await updateQueueCount();

  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", {
        scope: "./",
      });
      // Background Sync when available (not on iOS Safari as of now)
      if ("sync" in reg) {
        window.addEventListener("online", () =>
          reg.sync.register("sync-submissions")
        );
      } else {
        window.addEventListener("online", () => syncAll());
      }

      // Listen for sync message from SW
      navigator.serviceWorker.addEventListener("message", (evt) => {
        if (evt.data && evt.data.type === "DO_SYNC") syncAll();
      });
    } catch (e) {
      console.warn("SW register failed", e);
    }
  } else {
    window.addEventListener("online", () => syncAll());
  }
});

window.addEventListener("online", setNetStatus);
window.addEventListener("offline", setNetStatus);

// ======= UI events =======
$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const button = $("#sub");

  button.textContent = "Submitting...";
  button.disabled = true;

  const payload = {
    id: undefined, // will be filled by IndexedDB
    uid: uid(),
    name: $("#name").value.trim(),
    fbName: $("#fbName").value.trim(),
    age: $("#age").value.trim(),
    schoolWork: $("#schoolWork").value.trim(),
    birthday: $("#birthday").value.trim(),
    firstTimer: $("#firstTimer").value.trim(),
    invited: $("#invited").value.trim(),
    // client_ts: new Date().toISOString(),
    // ua: navigator.userAgent,
    token: SHARED_SECRET,
  };

  if (
    !payload.name ||
    !payload.fbName ||
    !payload.age ||
    !payload.schoolWork ||
    !payload.birthday ||
    !payload.firstTimer ||
    !payload.invited
  ) {
    toast("Please fill out all fields.");
    button.textContent = "Submit";
    button.disabled = false;
    return;
  }

  // Try live first; if it fails (or offline), queue
  try {
    if (!navigator.onLine) throw new Error("offline");
    const ok = await sendOne(payload);
    if (ok) {
      e.target.reset();
      button.textContent = "Submit"; // reset
      button.disabled = false;
      toast("Submitted!");
      return; // nothing to queue
    }
    throw new Error("server");
  } catch (_) {
    await addToQueue(payload);
    await updateQueueCount();
    button.textContent = "Submit"; // reset
    button.disabled = false;
    e.target.reset();
    toast("Saved offline. Will sync later.");
    // trigger a background sync if possible
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      if ("sync" in reg) {
        try {
          await reg.sync.register("sync-submissions");
        } catch (_) {}
      }
    }
  }

  button.textContent = "Submit"; // reset
  button.disabled = false;
});

$("#syncBtn").addEventListener("click", () => syncAll());
// $("#keepAwakeBtn").addEventListener("click", () => requestWakeLock());
// $("#lockPortraitBtn").addEventListener("click", () => lockPortrait());

const select = document.getElementById("firstTimer");
const extraInput = document.getElementById("box");

  select.addEventListener("change", () => {
    if (select.value === "Yes") {
      extraInput.style.display = "block";
    } else {
      extraInput.style.display = "none";
    }
  });