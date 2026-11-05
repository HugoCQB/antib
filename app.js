const $ = id => document.getElementById(id);

const DURATION_TIERS = [
  { id: "1m",   label: "≥ 1m",   minSec: 60,    rateFull: 0.15, rateSacrifice: 0.12, buyMult: 2.5 },
  { id: "2m",   label: "≥ 2m",   minSec: 120,   rateFull: 0.17, rateSacrifice: 0.13, buyMult: 2.3 },
  { id: "5m",   label: "≥ 5m",   minSec: 300,   rateFull: 0.20, rateSacrifice: 0.15, buyMult: 2.2 },
  { id: "10m",  label: "≥ 10m",  minSec: 600,   rateFull: 0.25, rateSacrifice: 0.18, buyMult: 2.0 },
  { id: "15m",  label: "≥ 15m",  minSec: 900,   rateFull: 0.30, rateSacrifice: 0.22, buyMult: 1.8 },
  { id: "30m",  label: "≥ 30m",  minSec: 1800,  rateFull: 0.35, rateSacrifice: 0.18, buyMult: 1.5 },
  { id: "45m",  label: "≥ 45m",  minSec: 2700,  rateFull: 0.40, rateSacrifice: 0.20, buyMult: 1.4 },
  { id: "1h",   label: "≥ 1h",   minSec: 3600,  rateFull: 0.45, rateSacrifice: 0.22, buyMult: 1.3 },
  { id: "1h30", label: "≥ 1h30", minSec: 5400,  rateFull: 0.50, rateSacrifice: 0.25, buyMult: 1.25 },
  { id: "2h",   label: "≥ 2h",   minSec: 7200,  rateFull: 0.55, rateSacrifice: 0.24, buyMult: 1.2 },
  { id: "2h30", label: "≥ 2h30", minSec: 9000,  rateFull: 0.58, rateSacrifice: 0.24, buyMult: 1.15 },
  { id: "3h",   label: "≥ 3h",   minSec: 10800, rateFull: 0.60, rateSacrifice: 0.24, buyMult: 1.15 },
  { id: "3h30", label: "≥ 3h30", minSec: 12600, rateFull: 0.62, rateSacrifice: 0.25, buyMult: 1.1 },
  { id: "4h",   label: "≥ 4h",   minSec: 14400, rateFull: 0.64, rateSacrifice: 0.25, buyMult: 1.1 },
  { id: "4h30", label: "≥ 4h30", minSec: 16200, rateFull: 0.65, rateSacrifice: 0.25, buyMult: 1.1 },
  { id: "5h",   label: "≥ 5h",   minSec: 18000, rateFull: 0.66, rateSacrifice: 0.26, buyMult: 1.1 },
  { id: "5h30", label: "≥ 5h30", minSec: 19800, rateFull: 0.67, rateSacrifice: 0.26, buyMult: 1.1 },
  { id: "6h",   label: "≥ 6h",   minSec: 21600, rateFull: 0.68, rateSacrifice: 0.26, buyMult: 1.1 }
];

const SURPRISE_CHANCE_PER_SEC = 1 / 5;

const PATTERNS = {
  running: ["ATTENDRE.", "ATTENDRE..", "ATTENDRE..."],
  mid: ["VALIDER..", "VALIDER...", "VALIDER...."],
  final: ["CONFIRMER", "CONFIRMER.", "CONFIRMER.."]
};

// Endpoint REST officiel Firebase Realtime Database
const FIREBASE_DB_URL = "https://antibrainrotting-4f194-default-rtdb.europe-west1.firebasedatabase.app";

let syncKey = localStorage.getItem("meditation_sync_key") || null;
let selectedTierId = "1m", running = false, presenceMode = null;
let targetSeconds = 0, elapsedSeconds = 0, pauseOffsetMs = 0, pauseStartMs = 0, startTime = 0;
let masterInterval = null, presenceTimer = null, flickerTimeout = null;
let flickerIndex = 0;
let pendingVictory = null;

const dateJour = () => new Date().toISOString().slice(0, 10);
const ecartJours = (d1, d2) => (!d1 || !d2) ? 999 : Math.round((new Date(d2) - new Date(d1)) / 864e5);
const storageGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error(e); } };

const stopIfRunning = () => { if (running) declarerEchec("APPLICATION QUITTÉE"); };
document.addEventListener("visibilitychange", () => { if (document.hidden) stopIfRunning(); });
window.addEventListener("pagehide", stopIfRunning);

/* GESTION DE LA SYNCHRONISATION FIREBASE */

function updateSyncStatus(msg, isSuccess = false) {
  const el = $('syncStatus');
  if (!el) return;
  el.textContent = `SYNC : ${msg}`;
  el.style.borderColor = isSuccess ? "#fff" : "#555";
  el.style.color = isSuccess ? "#fff" : "#aaa";
}

function updateSyncKeyUI() {
  const el = $('syncKeyLabel');
  if (!el) return;
  el.textContent = syncKey ? `CLÉ : ${syncKey}` : "CLÉ : CRÉATION...";
}

function genererNouvelleCle() {
  return "ABR-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function changerOuCopierCle() {
  if (running) return;
  const saisie = prompt(
    "Copiez votre clé ou laissez vide pour en régénérer une nouvelle :",
    syncKey || ""
  );
  if (saisie === null) return;

  const cleNettoyee = saisie.trim();

  if (!cleNettoyee) {
    syncKey = genererNouvelleCle();
    localStorage.setItem("meditation_sync_key", syncKey);
    updateSyncKeyUI();
    await pushToCloud();
    return;
  }

  syncKey = cleNettoyee;
  localStorage.setItem("meditation_sync_key", syncKey);
  updateSyncKeyUI();
  await pullFromCloud();
}

function fusionnerDonnees(local, distant) {
  const fusion = { ...local };
  const today = dateJour();

  fusion.bankSeconds = Math.max(local.bankSeconds || 0, distant.bankSeconds || 0);
  fusion.dayStreakRecord = Math.max(local.dayStreakRecord || 0, distant.dayStreakRecord || 0);

  if (distant.lastActiveDate === today) {
    fusion.lastActiveDate = today;
    fusion.dayStreak = Math.max(local.dayStreak || 0, distant.dayStreak || 0);
  }

  fusion.tiers = {};
  DURATION_TIERS.forEach(t => {
    const locTier = local.tiers?.[t.id] || { streak: 0, record: 0, lastDate: null };
    const distTier = distant.tiers?.[t.id] || { streak: 0, record: 0, lastDate: null };

    const lastDate = (locTier.lastDate === today || distTier.lastDate === today) ? today : (locTier.lastDate || distTier.lastDate);
    const streak = Math.max(locTier.streak || 0, distTier.streak || 0);
    const record = Math.max(locTier.record || 0, distTier.record || 0);

    fusion.tiers[t.id] = { streak, record, lastDate };
  });

  return fusion;
}

async function pullFromCloud() {
  if (!navigator.onLine) {
    updateSyncStatus("HORS LIGNE");
    return;
  }

  if (!syncKey) {
    syncKey = genererNouvelleCle();
    localStorage.setItem("meditation_sync_key", syncKey);
    updateSyncKeyUI();
    await pushToCloud();
    return;
  }

  updateSyncStatus("CHARGEMENT...");
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/users/${encodeURIComponent(syncKey)}.json`);

    if (!res.ok) throw new Error(`Status HTTP: ${res.status}`);

    const payload = await res.json();

    // Première synchronisation pour cette clé : on téléverse l'état local
    if (!payload) {
      await pushToCloud();
      return;
    }

    const distantData = parserEtValiderStats(payload);
    const localData = chargerDonneesStats();
    const merged = fusionnerDonnees(localData, distantData);

    enregistrerDonneesStats(merged, false);
    rafraichirAffichageStats();
    updateSyncStatus("À JOUR", true);
  } catch (e) {
    console.error("Erreur lecture Firebase:", e);
    updateSyncStatus("ERREUR LECTURE");
  }
}

async function pushToCloud() {
  if (!navigator.onLine) return;

  if (!syncKey) {
    syncKey = genererNouvelleCle();
    localStorage.setItem("meditation_sync_key", syncKey);
    updateSyncKeyUI();
  }

  updateSyncStatus("ENVOI...");
  try {
    const stats = chargerDonneesStats();

    const res = await fetch(`${FIREBASE_DB_URL}/users/${encodeURIComponent(syncKey)}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stats)
    });

    if (!res.ok) throw new Error(`Mise à jour Firebase échouée: ${res.status}`);

    updateSyncStatus("SYNCHRONISÉ", true);
  } catch (e) {
    console.error("Erreur écriture Firebase:", e);
    updateSyncStatus("ERREUR ENVOI");
  }
}

/* FLICKER & CORE */

function demarrerFlicker() {
  arreterFlicker();
  const tick = () => {
    flickerIndex++;
    let currentList = null;

    if (presenceMode === 'mid') currentList = PATTERNS.mid;
    else if (presenceMode === 'final') currentList = PATTERNS.final;
    else if (running) currentList = PATTERNS.running;

    if (currentList) {
      $('actionBtn').textContent = currentList[flickerIndex % currentList.length];
    }

    const delay = Math.floor(Math.random() * 180) + 250;
    flickerTimeout = setTimeout(tick, delay);
  };
  tick();
}

function arreterFlicker() {
  if (flickerTimeout) {
    clearTimeout(flickerTimeout);
    flickerTimeout = null;
  }
}

function updateStreakData(target, lastKey, streakKey, recordKey, today) {
  if (target[lastKey] !== today) {
    target[streakKey] = ecartJours(target[lastKey], today) === 1 ? target[streakKey] + 1 : 1;
    target[lastKey] = today;
  }
  target[recordKey] = Math.max(target[streakKey], target[recordKey] || 0);
}

function parserEtValiderStats(data = {}) {
  const today = dateJour();
  const tiers = {};
  DURATION_TIERS.forEach(t => {
    const raw = (data.tiers && data.tiers[t.id]) || {};
    const streak = ecartJours(raw.lastDate, today) > 1 ? 0 : (raw.streak || 0);
    tiers[t.id] = { streak, record: Math.max(streak, raw.record || 0), lastDate: raw.lastDate || null };
  });

  const dayStreak = ecartJours(data.lastActiveDate, today) > 1 ? 0 : (data.dayStreak || 0);
  return {
    lastActiveDate: data.lastActiveDate || null,
    dayStreak,
    dayStreakRecord: Math.max(dayStreak, data.dayStreakRecord || 0),
    bankSeconds: data.bankSeconds || 0,
    tiers
  };
}

const chargerDonneesStats = () => parserEtValiderStats(storageGet('meditation_presence_stats', {}));

function enregistrerDonneesStats(data, syncDistante = true) {
  storageSet('meditation_presence_stats', data);
  if (syncDistante) pushToCloud();
}

function sauvegarderParametres() {
  storageSet('meditation_presence_config', { selectedTierId });
}

function chargerParametres() {
  const conf = storageGet('meditation_presence_config', {});
  if (DURATION_TIERS.some(t => t.id === conf.selectedTierId)) selectedTierId = conf.selectedTierId;
}

const getTierActuel = () => DURATION_TIERS.find(t => t.id === selectedTierId) || DURATION_TIERS[0];
const getTierCout = t => Math.round(t.minSec * t.buyMult);

function actualiserBoutonRecommencer() {
  if (!running && !pendingVictory) {
    arreterFlicker();
    setBouton(`COMMENCER\n${formaterTemps(getTierActuel().minSec)}`);
  }
}

function selectionnerPalier(id) {
  if (running || pendingVictory) return;
  selectedTierId = id;
  sauvegarderParametres();
  rafraichirAffichageStats();
  actualiserBoutonRecommencer();
}

function rafraichirAffichageStats() {
  const data = chargerDonneesStats();
  const today = dateJour();
  const tierObj = getTierActuel();

  $('statDayStreak').textContent = `${data.dayStreak}j`;
  $('statDayStreakRecord').textContent = `Record : ${data.dayStreakRecord}j`;
  $('statBank').textContent = formaterTemps(data.bankSeconds, true);

  $('tiersContainer').replaceChildren(...DURATION_TIERS.map(t => {
    const tData = data.tiers[t.id];
    const isDone = tData.lastDate === today;
    const box = document.createElement('div');
    box.className = `tier-box ${isDone ? "completed-today" : "locked"} ${selectedTierId === t.id ? "selected-target" : ""}`;
    box.onclick = () => selectionnerPalier(t.id);
    box.innerHTML = `
      <span class="tier-label">${t.label}</span>
      <span class="tier-val">${tData.streak}j</span>
      <span class="tier-rec">r:${tData.record}</span>
      <span class="tier-mult">×${t.rateFull}</span>
      <span class="tier-sac">s:×${t.rateSacrifice}</span>
    `;
    return box;
  }));

  const isDoneToday = data.tiers[tierObj.id]?.lastDate === today;
  const idle = !running && !pendingVictory;

  $('bonusInfo').style.display = (idle && isDoneToday) ? 'flex' : 'none';
  if (isDoneToday) $('bonusInfo').textContent = `Palier ${tierObj.label} déjà validé`;

  const buySec = $('buySection');
  if (idle && !isDoneToday) {
    const cout = getTierCout(tierObj);
    buySec.style.display = 'block';
    $('btnBuyStreak').textContent = `Acheter streak ${tierObj.label}×${tierObj.buyMult} (${formaterTemps(cout, true)})`;
    $('btnBuyStreak').disabled = data.bankSeconds < cout;
  } else {
    buySec.style.display = 'none';
  }
}

function validerStreakJour(stats, tier, today) {
  updateStreakData(stats, 'lastActiveDate', 'dayStreak', 'dayStreakRecord', today);
  const tData = stats.tiers[tier.id] = stats.tiers[tier.id] || { streak: 0, record: 0, lastDate: null };
  updateStreakData(tData, 'lastDate', 'streak', 'record', today);
}

function acheterStreak() {
  if (running || pendingVictory) return;
  const data = chargerDonneesStats();
  const tier = getTierActuel();
  const cout = getTierCout(tier);

  if (data.bankSeconds < cout) return alert("Solde de temps insuffisant.");

  data.bankSeconds -= cout;
  validerStreakJour(data, tier, dateJour());
  enregistrerDonneesStats(data);
  rafraichirAffichageStats();
  alert(`Streak ${tier.label} acheté avec succès !`);
}

function setModeRecompense(actif) {
  $('rewardChoiceSection').style.display = actif ? 'flex' : 'none';
  $('actionBtn').style.display = actif ? 'none' : 'flex';
}

function traiterRecompenseSession(choix) {
  if (!pendingVictory) return;
  const { dureeReelle, targetTier } = pendingVictory;
  const stats = chargerDonneesStats();
  let texteResultat = "";

  if (choix === 'streak') {
    validerStreakJour(stats, targetTier, dateJour());
    texteResultat = "STREAK COMPTABILISÉ";
  } else {
    const isSacrifice = choix === 'bank_half';
    const gain = Math.floor(dureeReelle * (isSacrifice ? targetTier.rateSacrifice : targetTier.rateFull));
    stats.bankSeconds += gain;
    texteResultat = `+${formaterTemps(gain)} ${isSacrifice ? '(SACRIFICE)' : 'SOLDÉ'}`;
  }

  enregistrerDonneesStats(stats);
  rafraichirAffichageStats();

  const tempsTenu = formaterTemps(dureeReelle);
  pendingVictory = null;
  setModeRecompense(false);
  arreterFlicker();
  setBouton(`GAGNÉ (${tempsTenu})\n${texteResultat}\nRECOMMENCER`);
}

function formaterTemps(totalSec, compact = false) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(compact ? '' : ' ');
}

function toggleFormInputs(disabled) {
  if (disabled) $('buySection').style.display = $('bonusInfo').style.display = 'none';
  else rafraichirAffichageStats();
}

function setBouton(label = "COMMENCER", className = "") {
  toggleFormInputs(className === "stop" || className === "presence");
  $('actionBtn').textContent = label;
  $('actionBtn').className = className;
}

function handleClick() {
  if (presenceMode === 'mid') {
    clearTimeout(presenceTimer);
    presenceMode = null;
    pauseOffsetMs += (Date.now() - pauseStartMs);
    setBouton(PATTERNS.running[0], "stop");
  } else if (presenceMode === 'final') {
    clearTimeout(presenceTimer);
    presenceMode = null;
    arreterFlicker();

    const stats = chargerDonneesStats();
    const targetTier = getTierActuel();
    pendingVictory = { dureeReelle: targetSeconds, targetTier };

    if (stats.tiers[targetTier.id]?.lastDate !== dateJour()) {
      $('btnChooseStreak').textContent = `VALIDER SÉRIE ${targetTier.label}`;
      $('btnChooseBank').textContent = `SOLDE TEMPS : +${formaterTemps(Math.floor(targetSeconds * targetTier.rateSacrifice))} (×${targetTier.rateSacrifice})`;
      setModeRecompense(true);
      toggleFormInputs(true);
    } else {
      traiterRecompenseSession('bank_full');
    }
  } else if (running) {
    declarerEchec("ABANDON");
  } else {
    demarrerSession();
  }
}

function demarrerSession() {
  sauvegarderParametres();
  targetSeconds = getTierActuel().minSec;
  elapsedSeconds = pauseOffsetMs = 0;
  startTime = Date.now();
  presenceMode = pendingVictory = null;

  running = true;
  setModeRecompense(false);
  setBouton(PATTERNS.running[0], "stop");
  demarrerFlicker();

  clearInterval(masterInterval);
  masterInterval = setInterval(moteurTemps, 200);
}

function moteurTemps() {
  if (!running || presenceMode !== null) return;

  const currentSec = Math.floor((Date.now() - startTime - pauseOffsetMs) / 1000);
  if (currentSec <= elapsedSeconds) return;

  while (elapsedSeconds < currentSec && running && presenceMode === null) {
    elapsedSeconds++;

    if (elapsedSeconds >= targetSeconds) {
      clearInterval(masterInterval);
      running = false;
      activerCompteARebours('final', 5, PATTERNS.final[0], "NON VALIDÉ");
      return;
    }

    if (Math.random() < SURPRISE_CHANCE_PER_SEC) {
      pauseStartMs = Date.now();
      activerCompteARebours('mid', 5, PATTERNS.mid[0], "CONTRÔLE MANQUÉ");
      return;
    }
  }
}

function activerCompteARebours(mode, seconds, initialText, failReason) {
  clearTimeout(presenceTimer);
  presenceMode = mode;
  setBouton(initialText, "presence");
  presenceTimer = setTimeout(() => {
    if (presenceMode === mode) declarerEchec(failReason);
  }, seconds * 1000);
}

function declarerEchec(raison = "NON VALIDÉ") {
  presenceMode = pendingVictory = null;
  running = false;
  arreterFlicker();
  clearInterval(masterInterval);
  clearTimeout(presenceTimer);
  setModeRecompense(false);
  setBouton(`PERDU (${formaterTemps(elapsedSeconds)})\n${raison}\nRECOMMENCER`);
}

$('btnSyncKey').addEventListener('click', changerOuCopierCle);
$('actionBtn').addEventListener('click', handleClick);
$('btnBuyStreak').addEventListener('click', acheterStreak);
$('btnChooseStreak').addEventListener('click', () => traiterRecompenseSession('streak'));
$('btnChooseBank').addEventListener('click', () => traiterRecompenseSession('bank_half'));

updateSyncKeyUI();
chargerParametres();
rafraichirAffichageStats();
actualiserBoutonRecommencer();

// Lancement automatique du sync distant
pullFromCloud();
