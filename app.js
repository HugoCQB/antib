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

let selectedTierId = "1m", running = false, presenceMode = null;
let targetSeconds = 0, elapsedSeconds = 0, pauseOffsetMs = 0, pauseStartMs = 0, startTime = 0;
let masterInterval = null, presenceTimer = null;
let pendingVictory = null;

// File ordonnée des secondes cibles précalculées
let scheduledSurprises = [];

// Helpers & Storage
const dateJour = () => new Date().toISOString().slice(0, 10);
const ecartJours = (d1, d2) => (!d1 || !d2) ? 999 : Math.round((new Date(d2) - new Date(d1)) / 864e5);
const storageGet = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } };
const storageSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error(e); } };

const stopIfRunning = () => { if (running) declarerEchec("APPLICATION QUITTÉE"); };
document.addEventListener("visibilitychange", () => { if (document.hidden) stopIfRunning(); });
window.addEventListener("pagehide", stopIfRunning);

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
const enregistrerDonneesStats = data => storageSet('meditation_presence_stats', data);

function sauvegarderParametres() {
  storageSet('meditation_presence_config', { selectedTierId, surpriseFreq: $('surpriseFreq').value });
}

function chargerParametres() {
  const conf = storageGet('meditation_presence_config', {});
  if (DURATION_TIERS.some(t => t.id === conf.selectedTierId)) selectedTierId = conf.selectedTierId;
  if (conf.surpriseFreq !== undefined && $('surpriseFreq')) $('surpriseFreq').value = conf.surpriseFreq;
}

// Import / Export
function exporterDonneesJSON() {
  const blob = new Blob([JSON.stringify({
    version: 1,
    dateExport: new Date().toISOString(),
    stats: chargerDonneesStats(),
    config: { selectedTierId, surpriseFreq: $('surpriseFreq').value }
  }, null, 2)], { type: "application/json" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `anti-brainrotting-backup-${dateJour()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function declencherImportation() {
  if (running && !confirm("Une session est en cours. Continuer annulera la session actuelle.")) return;
  if (running) declarerEchec("SESSION RÉINITIALISÉE PAR IMPORT");
  $('fileInputImport').click();
}

function gererFichierImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const payload = JSON.parse(ev.target.result);
      if (!payload?.stats) throw new Error("Format JSON non valide : bloc 'stats' manquant.");
      enregistrerDonneesStats(parserEtValiderStats(payload.stats));
      if (payload.config) {
        if (DURATION_TIERS.some(t => t.id === payload.config.selectedTierId)) selectedTierId = payload.config.selectedTierId;
        if (payload.config.surpriseFreq !== undefined) $('surpriseFreq').value = payload.config.surpriseFreq;
        sauvegarderParametres();
      }
      rafraichirAffichageStats();
      actualiserBoutonRecommencer();
      alert("Progression restaurée avec succès !");
    } catch (err) {
      alert("Erreur lors de l'import : " + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

// Métier & Affichage
const getTierActuel = () => DURATION_TIERS.find(t => t.id === selectedTierId) || DURATION_TIERS[0];
const getTierCout = t => Math.round(t.minSec * t.buyMult);

function actualiserBoutonRecommencer() {
  if (!running && !pendingVictory) setBouton(`COMMENCER\n${formaterTemps(getTierActuel().minSec)}`);
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
  $('surpriseFreq').disabled = disabled;
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
    setBouton("ABANDONNER", "stop");
  } else if (presenceMode === 'final') {
    clearTimeout(presenceTimer);
    presenceMode = null;

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

/**
 * Découpe la session en tranches égales et tire une seconde uniforme par tranche.
 * Seule contrainte : un contrôle ne peut pas survenir à la même seconde qu'un autre.
 */
function genererControlesParFenetres(totalSec, freqVal) {
  if (freqVal <= 0 || totalSec <= 0) return [];

  const fenetreSec = Math.round(1 / freqVal);
  const instansPris = new Set();
  const liste = [];

  for (let debutFenetre = 0; debutFenetre < totalSec; debutFenetre += fenetreSec) {
    const finFenetre = Math.min(debutFenetre + fenetreSec, totalSec);
    const minSec = debutFenetre;
    const maxSec = finFenetre - 1;

    if (minSec <= maxSec) {
      let instant = Math.floor(minSec + Math.random() * (maxSec - minSec + 1));
      
      // En cas de collision rarissime sur la même seconde, on décale
      if (instansPris.has(instant)) {
        if (instant + 1 < totalSec && !instansPris.has(instant + 1)) {
          instant++;
        } else if (instant - 1 >= 0 && !instansPris.has(instant - 1)) {
          instant--;
        }
      }

      if (!instansPris.has(instant)) {
        instansPris.add(instant);
        liste.push(instant);
      }
    }
  }

  // Tri chronologique au cas où un décalage a été appliqué
  return liste.sort((a, b) => a - b);
}

function demarrerSession() {
  sauvegarderParametres();
  targetSeconds = getTierActuel().minSec;
  elapsedSeconds = pauseOffsetMs = 0;
  startTime = Date.now();
  presenceMode = pendingVictory = null;

  const freqVal = parseFloat($('surpriseFreq').value) || 0;
  scheduledSurprises = genererControlesParFenetres(targetSeconds, freqVal);

  running = true;
  setModeRecompense(false);
  setBouton("ABANDONNER", "stop");

  clearInterval(masterInterval);
  masterInterval = setInterval(moteurTemps, 200);
}

function moteurTemps() {
  if (!running || presenceMode !== null) return;

  const currentSec = Math.floor((Date.now() - startTime - pauseOffsetMs) / 1000);
  if (currentSec <= elapsedSeconds) return;
  elapsedSeconds = currentSec;

  if (elapsedSeconds >= targetSeconds) {
    clearInterval(masterInterval);
    running = false;
    activerCompteARebours('final', 5, "ATTENTION!!!!", "NON VALIDÉ");
    return;
  }

  // Déclenchement dès que la seconde cible programmée est atteinte
  if (scheduledSurprises.length > 0 && elapsedSeconds >= scheduledSurprises[0]) {
    scheduledSurprises.shift();
    pauseStartMs = Date.now();
    activerCompteARebours('mid', 5, "ATTENTION????", "CONTRÔLE MANQUÉ");
  }
}

function activerCompteARebours(mode, seconds, symbol, failReason) {
  clearTimeout(presenceTimer);
  presenceMode = mode;
  setBouton(symbol, "presence");
  presenceTimer = setTimeout(() => {
    if (presenceMode === mode) declarerEchec(failReason);
  }, seconds * 1000);
}

function declarerEchec(raison = "NON VALIDÉ") {
  presenceMode = pendingVictory = null;
  scheduledSurprises = [];
  running = false;
  clearInterval(masterInterval);
  clearTimeout(presenceTimer);
  setModeRecompense(false);
  setBouton(`PERDU (${formaterTemps(elapsedSeconds)})\n${raison}\nRECOMMENCER`);
}

// Événements
$('btnExport').addEventListener('click', exporterDonneesJSON);
$('btnImport').addEventListener('click', declencherImportation);
$('fileInputImport').addEventListener('change', gererFichierImport);
$('actionBtn').addEventListener('click', handleClick);
$('btnBuyStreak').addEventListener('click', acheterStreak);
$('btnChooseStreak').addEventListener('click', () => traiterRecompenseSession('streak'));
$('btnChooseBank').addEventListener('click', () => traiterRecompenseSession('bank_half'));
$('surpriseFreq').addEventListener('change', sauvegarderParametres);

// Initialisation
chargerParametres();
rafraichirAffichageStats();
actualiserBoutonRecommencer();
