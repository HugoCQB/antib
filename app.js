const $ = id => document.getElementById(id);

const DURATION_TIERS = [
  { label: "1m",   minSec: 60,    rateFull: 0.15, rateSacrifice: 0.12, buyMult: 2.5 },
  { label: "2m",   minSec: 120,   rateFull: 0.17, rateSacrifice: 0.13, buyMult: 2.3 },
  { label: "5m",   minSec: 300,   rateFull: 0.20, rateSacrifice: 0.15, buyMult: 2.2 },
  { label: "10m",  minSec: 600,   rateFull: 0.25, rateSacrifice: 0.18, buyMult: 2.0 },
  { label: "15m",  minSec: 900,   rateFull: 0.30, rateSacrifice: 0.22, buyMult: 1.8 },
  { label: "30m",  minSec: 1800,  rateFull: 0.35, rateSacrifice: 0.18, buyMult: 1.5 },
  { label: "45m",  minSec: 2700,  rateFull: 0.40, rateSacrifice: 0.20, buyMult: 1.4 },
  { label: "1h",   minSec: 3600,  rateFull: 0.45, rateSacrifice: 0.22, buyMult: 1.3 },
  { label: "1h30", minSec: 5400,  rateFull: 0.50, rateSacrifice: 0.25, buyMult: 1.25 },
  { label: "2h",   minSec: 7200,  rateFull: 0.55, rateSacrifice: 0.24, buyMult: 1.2 },
  { label: "2h30", minSec: 9000,  rateFull: 0.58, rateSacrifice: 0.24, buyMult: 1.15 },
  { label: "3h",   minSec: 10800, rateFull: 0.60, rateSacrifice: 0.24, buyMult: 1.15 },
  { label: "3h30", minSec: 12600, rateFull: 0.62, rateSacrifice: 0.25, buyMult: 1.1 },
  { label: "4h",   minSec: 14400, rateFull: 0.64, rateSacrifice: 0.25, buyMult: 1.1 },
  { label: "4h30", minSec: 16200, rateFull: 0.65, rateSacrifice: 0.25, buyMult: 1.1 },
  { label: "5h",   minSec: 18000, rateFull: 0.66, rateSacrifice: 0.26, buyMult: 1.1 },
  { label: "5h30", minSec: 19800, rateFull: 0.67, rateSacrifice: 0.26, buyMult: 1.1 },
  { label: "6h",   minSec: 21600, rateFull: 0.68, rateSacrifice: 0.26, buyMult: 1.1 }
];

const PATTERNS = {
  running: ["ATTENDRE.", "ATTENDRE..", "ATTENDRE..."],
  final: ["VALIDER..", "VALIDER...", "VALIDER...."]
};

const FIREBASE_DB_URL = "https://antibrainrotting-4f194-default-rtdb.europe-west1.firebasedatabase.app";

let syncKey = localStorage.getItem("meditation_sync_key") || null;
let currentKeyPassword = localStorage.getItem("meditation_sync_pwd") || "";
let selectedTierLabel = "1m", running = false, finalValidationMode = false;
let victoryDisplayMode = false, defeatDisplayMode = false;
let targetSeconds = 0, elapsedSeconds = 0, startTime = 0, lastCheckTime = 0;
let masterInterval = null, presenceTimer = null, flickerTimeout = null;
let flickerIndex = 0;
let pendingVictory = null;

let hiddenTimeout = null;
const GRACE_PERIOD_MS = 10000;

function annulerTimeoutVisibilite() {
  if (hiddenTimeout) {
    clearTimeout(hiddenTimeout);
    hiddenTimeout = null;
  }
}

function gererChangementVisibilite() {
  if (!running && !finalValidationMode) {
    annulerTimeoutVisibilite();
    return;
  }

  const estMasque = document.hidden || !document.hasFocus();

  if (estMasque) {
    if (!hiddenTimeout) {
      hiddenTimeout = setTimeout(() => {
        declarerEchec("FENÊTRE CACHÉE (>10s)");
      }, GRACE_PERIOD_MS);
    }
  } else {
    annulerTimeoutVisibilite();
  }
}

document.addEventListener("visibilitychange", gererChangementVisibilite);
window.addEventListener("blur", gererChangementVisibilite);
window.addEventListener("focus", gererChangementVisibilite);
window.addEventListener("pagehide", () => {
  if (running || finalValidationMode) declarerEchec("APPLICATION QUITTÉE");
});

// GESTION DU POPUP DES RÈGLES DU JEU
const btnToggleRules = $('btnToggleRules');
const rulesOverlay = $('rulesOverlay');
const btnCloseRules = $('btnCloseRules');
const btnOkRules = $('btnOkRules');

function ouvrirRules(e) {
  if (e) e.preventDefault();
  if (rulesOverlay) rulesOverlay.classList.remove('hidden');
}

function fermerRules(e) {
  if (e) e.preventDefault();
  if (rulesOverlay) rulesOverlay.classList.add('hidden');
}

if (btnToggleRules) {
  btnToggleRules.addEventListener('click', ouvrirRules);
  btnToggleRules.addEventListener('touchstart', ouvrirRules, { passive: false });
}

if (btnCloseRules) {
  btnCloseRules.addEventListener('click', fermerRules);
  btnCloseRules.addEventListener('touchstart', fermerRules, { passive: false });
}

if (btnOkRules) {
  btnOkRules.addEventListener('click', fermerRules);
  btnOkRules.addEventListener('touchstart', fermerRules, { passive: false });
}

if (rulesOverlay) {
  rulesOverlay.addEventListener('click', (e) => {
    if (e.target === rulesOverlay) fermerRules(e);
  });
}

// FIX 1: Utilisation de la date au format ISO UTC pour uniformiser tous les appareils
const dateJour = () => new Date().toISOString().split('T')[0];

const ecartJours = (d1, d2) => (!d1 || !d2) ? 999 : Math.round((new Date(d2) - new Date(d1)) / 864e5);
const storageGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error(e); } };

async function hashPassword(str) {
  if (!str) return null;
  const buffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  const isLocked = Boolean(currentKeyPassword);
  el.textContent = syncKey ? `CLÉ ${isLocked ? "[VERROUILLÉE]" : ""}` : "CLÉ : CRÉATION...";
}

function genererNouvelleCle() {
  return "ABR-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function reinitialiserDonneesLocales() {
  selectedTierLabel = "1m";
  sauvegarderParametres();

  const emptyStats = parserEtValiderStats({ bankSeconds: 0 });
  await enregistrerDonneesStats(emptyStats, false);
  
  annulerTimeoutVisibilite();
  pendingVictory = null;
  running = false;
  finalValidationMode = false;
  victoryDisplayMode = false;
  defeatDisplayMode = false;
  setModeRecompense(false);
  rafraichirAffichageStats();
  actualiserBoutonRecommencer();
}

async function changerOuCopierCle() {
  if (running) return;

  const action = prompt(
    `Clé actuelle : ${syncKey || "Aucune"}\n\n` +
    `1. Changer ou créer une clé\n` +
    `2. Définir / modifier le mot de passe de cette clé\n` +
    `Entrez 1, 2 ou directement une nouvelle clé :`
  );

  if (action === null) return;
  const saisie = action.trim();

  if (saisie === "2") {
    if (!syncKey) {
      alert("Veuillez d'abord générer ou charger une clé.");
      return;
    }
    const nouveauMdp = prompt("Définissez un mot de passe (laissez vide pour retirer le verrou) :");
    if (nouveauMdp === null) return;

    currentKeyPassword = nouveauMdp.trim();
    if (currentKeyPassword) {
      localStorage.setItem("meditation_sync_pwd", currentKeyPassword);
    } else {
      localStorage.removeItem("meditation_sync_pwd");
    }
    updateSyncKeyUI();
    await pushToCloud();
    return;
  }

  await reinitialiserDonneesLocales();

  let nouvelleCle = (saisie === "1") ? (prompt("Entrez la clé :") || "").trim() : saisie;

  if (!nouvelleCle) {
    syncKey = genererNouvelleCle();
    currentKeyPassword = "";
    localStorage.removeItem("meditation_sync_pwd");
    localStorage.setItem("meditation_sync_key", syncKey);
    updateSyncKeyUI();
    await pushToCloud();
    return;
  }

  syncKey = nouvelleCle;
  currentKeyPassword = "";
  localStorage.removeItem("meditation_sync_pwd");
  localStorage.setItem("meditation_sync_key", syncKey);
  updateSyncKeyUI();
  await pullFromCloud();
}

// FIX 2: Algorithme de fusion intelligente (Merge) entre les données locales et les données du cloud
function fusionnerStats(locale, distante) {
  const latestDate = (d1, d2) => {
    if (!d1) return d2;
    if (!d2) return d1;
    return d1 > d2 ? d1 : d2;
  };

  const res = {
    dayStreak: Math.max(locale.dayStreak || 0, distante.dayStreak || 0),
    dayStreakRecord: Math.max(locale.dayStreakRecord || 0, distante.dayStreakRecord || 0),
    bankSeconds: Math.max(locale.bankSeconds || 0, distante.bankSeconds || 0),
    lastActiveDate: latestDate(locale.lastActiveDate, distante.lastActiveDate),
    tiers: {}
  };

  DURATION_TIERS.forEach(t => {
    const locT = (locale.tiers && locale.tiers[t.label]) || {};
    const disT = (distante.tiers && distante.tiers[t.label]) || {};

    res.tiers[t.label] = {
      streak: Math.max(locT.streak || 0, disT.streak || 0),
      record: Math.max(locT.record || 0, disT.record || 0),
      lastDate: latestDate(locT.lastDate, disT.lastDate)
    };
  });

  return parserEtValiderStats(res);
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

    if (!payload) {
      await reinitialiserDonneesLocales();
      await pushToCloud();
      return;
    }

    if (payload.passwordHash) {
      let tentatives = 0;
      let hashLocal = await hashPassword(currentKeyPassword);

      while (hashLocal !== payload.passwordHash && tentatives < 3) {
        const saisie = prompt(`La clé ${syncKey} est protégée par un mot de passe :`);
        if (saisie === null) {
          updateSyncStatus("ACCÈS REFUSÉ");
          return;
        }
        currentKeyPassword = saisie.trim();
        hashLocal = await hashPassword(currentKeyPassword);
        tentatives++;
      }

      if (hashLocal !== payload.passwordHash) {
        updateSyncStatus("MDP INCORRECT");
        alert("Mot de passe incorrect. Données non synchronisées.");
        return;
      }

      localStorage.setItem("meditation_sync_pwd", currentKeyPassword);
      updateSyncKeyUI();
    }

    const localData = chargerDonneesStats();
    const distantData = parserEtValiderStats(payload);
    const mergedData = fusionnerStats(localData, distantData);

    await enregistrerDonneesStats(mergedData, true);
    rafraichirAffichageStats();
    actualiserBoutonRecommencer();
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
    const checkRes = await fetch(`${FIREBASE_DB_URL}/users/${encodeURIComponent(syncKey)}/passwordHash.json`);
    if (checkRes.ok) {
      const distantHash = await checkRes.json();
      if (distantHash) {
        const localHash = await hashPassword(currentKeyPassword);
        if (distantHash !== localHash) {
          updateSyncStatus("ÉCRITURE REFUSÉE");
          alert("Impossible d'écrire sur cette clé : mot de passe incorrect.");
          return;
        }
      }
    }

    const stats = chargerDonneesStats();
    const hash = await hashPassword(currentKeyPassword);
    const payload = {
      ...stats,
      passwordHash: hash || null
    };

    const res = await fetch(`${FIREBASE_DB_URL}/users/${encodeURIComponent(syncKey)}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Mise à jour Firebase échouée: ${res.status}`);

    updateSyncStatus("SYNCHRONISÉ", true);
  } catch (e) {
    console.error("Erreur écriture Firebase:", e);
    updateSyncStatus("ERREUR ENVOI");
  }
}

function demarrerFlicker() {
  arreterFlicker();
  const tick = () => {
    flickerIndex++;
    let currentList = null;

    if (finalValidationMode) currentList = PATTERNS.final;
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
    const raw = (data.tiers && data.tiers[t.label]) || {};
    const streak = ecartJours(raw.lastDate, today) > 1 ? 0 : (raw.streak || 0);
    tiers[t.label] = { streak, record: Math.max(streak, raw.record || 0), lastDate: raw.lastDate || null };
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

// FIX 3: Rendre l'enregistrement asynchrone pour attendre la fin de la synchronisation cloud
async function enregistrerDonneesStats(data, syncDistante = true) {
  storageSet('meditation_presence_stats', data);
  if (syncDistante) {
    await pushToCloud();
  }
}

function sauvegarderParametres() {
  storageSet('meditation_presence_config', { selectedTierId: selectedTierLabel });
}

function chargerParametres() {
  const conf = storageGet('meditation_presence_config', {});
  if (DURATION_TIERS.some(t => t.label === conf.selectedTierId)) selectedTierLabel = conf.selectedTierId;
}

const getTierActuel = () => DURATION_TIERS.find(t => t.label === selectedTierLabel) || DURATION_TIERS[0];
const getTierCout = t => Math.round(t.minSec * t.buyMult);

function actualiserBoutonRecommencer() {
  if (!running && !pendingVictory && !victoryDisplayMode && !defeatDisplayMode) {
    arreterFlicker();
    setBouton(`COMMENCER ${formaterTemps(getTierActuel().minSec)}`);
  }
}

function selectionnerPalier(label) {
  if (running || pendingVictory) return;
  
  victoryDisplayMode = false;
  defeatDisplayMode = false;
  
  selectedTierLabel = label;
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
  $('statBank').textContent = formaterTemps(data.bankSeconds);

  $('tiersContainer').replaceChildren(...DURATION_TIERS.map(t => {
    const tData = data.tiers[t.label];
    const isDone = tData.lastDate === today;
    const box = document.createElement('div');
    box.className = `tier-box ${isDone ? "completed-today" : "locked"} ${selectedTierLabel === t.label ? "selected-target" : ""}`;
    box.onclick = () => selectionnerPalier(t.label);
    box.innerHTML = `
      <span class="tier-label">${t.label}</span>
      <span class="tier-val">${tData.streak}j</span>
      <span class="tier-rec">r:${tData.record}</span>
      <span class="tier-mult">×${t.rateFull}</span>
      <span class="tier-sac">s:×${t.rateSacrifice}</span>
    `;
    return box;
  }));

  const isDoneToday = data.tiers[tierObj.label]?.lastDate === today;
  const idle = !running && !pendingVictory;

  $('bonusInfo').style.display = (idle && isDoneToday) ? 'flex' : 'none';
  if (isDoneToday) $('bonusInfo').textContent = `Palier ${tierObj.label} déjà validé`;

  const buySec = $('buySection');
  if (idle && !isDoneToday) {
    const cout = getTierCout(tierObj);
    buySec.style.display = 'block';
    $('btnBuyStreak').textContent = `Acheter streak ${tierObj.label}×${tierObj.buyMult} (${formaterTemps(cout)})`;
    $('btnBuyStreak').disabled = data.bankSeconds < cout;
  } else {
    buySec.style.display = 'none';
  }
}

function validerStreakJour(stats, tier, today) {
  updateStreakData(stats, 'lastActiveDate', 'dayStreak', 'dayStreakRecord', today);
  const tData = stats.tiers[tier.label] = stats.tiers[tier.label] || { streak: 0, record: 0, lastDate: null };
  updateStreakData(tData, 'lastDate', 'streak', 'record', today);
}

async function acheterStreak() {
  if (running || pendingVictory || victoryDisplayMode || defeatDisplayMode) return;
  const data = chargerDonneesStats();
  const tier = getTierActuel();
  const cout = getTierCout(tier);

  if (data.bankSeconds < cout) return alert("Solde de temps insuffisant.");

  data.bankSeconds -= cout;
  validerStreakJour(data, tier, dateJour());
  await enregistrerDonneesStats(data, true);
  rafraichirAffichageStats();
  alert(`Streak ${tier.label} acheté avec succès !`);
}

function setModeRecompense(actif) {
  $('rewardChoiceSection').style.display = actif ? 'flex' : 'none';
  $('actionBtn').style.display = actif ? 'none' : 'flex';
}

async function traiterRecompenseSession(choix) {
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

  await enregistrerDonneesStats(stats, true);
  rafraichirAffichageStats();

  const tempsTenu = formaterTemps(dureeReelle);
  pendingVictory = null;
  setModeRecompense(false);
  arreterFlicker();

  victoryDisplayMode = true;
  setBouton(`GAGNÉ (${tempsTenu})\n${texteResultat}`);
}

function formaterTemps(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join('');
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
  if (victoryDisplayMode) {
    victoryDisplayMode = false;
    actualiserBoutonRecommencer();
  } else if (defeatDisplayMode) {
    defeatDisplayMode = false;
    actualiserBoutonRecommencer();
  } else if (finalValidationMode) {
    clearTimeout(presenceTimer);
    finalValidationMode = false;
    arreterFlicker();

    const stats = chargerDonneesStats();
    const targetTier = getTierActuel();
    pendingVictory = { dureeReelle: targetSeconds, targetTier };

    if (stats.tiers[targetTier.label]?.lastDate !== dateJour()) {
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
  
  const maxSec = getTierActuel().minSec;
  targetSeconds = Math.floor(Math.random() * maxSec) + 1;

  elapsedSeconds = 0;
  startTime = Date.now();
  lastCheckTime = Date.now();
  finalValidationMode = false;
  victoryDisplayMode = false;
  defeatDisplayMode = false;
  pendingVictory = null;

  annulerTimeoutVisibilite();

  running = true;
  setModeRecompense(false);
  setBouton(PATTERNS.running[0], "stop");
  demarrerFlicker();

  clearInterval(masterInterval);
  masterInterval = setInterval(moteurTemps, 200);
}

function moteurTemps() {
  if (!running || finalValidationMode) return;

  const now = Date.now();

  if (now - lastCheckTime > 10000) {
    declarerEchec("MISE EN VEILLE DÉTECTÉE (>10s)");
    return;
  }
  lastCheckTime = now;

  const currentSec = Math.floor((now - startTime) / 1000);
  if (currentSec <= elapsedSeconds) return;

  elapsedSeconds = currentSec;

  if (elapsedSeconds >= targetSeconds) {
    clearInterval(masterInterval);
    running = false;
    activerCompteAReboursConfirmation(5, PATTERNS.final[0], "NON VALIDÉ");
  }
}

function activerCompteAReboursConfirmation(seconds, initialText, failReason) {
  clearTimeout(presenceTimer);
  finalValidationMode = true;
  setBouton(initialText, "presence");
  presenceTimer = setTimeout(() => {
    if (finalValidationMode) declarerEchec(failReason);
  }, seconds * 1000);
}

function declarerEchec(raison = "NON VALIDÉ") {
  finalValidationMode = false;
  victoryDisplayMode = false;
  defeatDisplayMode = true;
  pendingVictory = null;
  running = false;

  annulerTimeoutVisibilite();
  arreterFlicker();
  clearInterval(masterInterval);
  clearTimeout(presenceTimer);
  setModeRecompense(false);
  setBouton(`PERDU (${formaterTemps(elapsedSeconds)})\n${raison}`);
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

pullFromCloud();
