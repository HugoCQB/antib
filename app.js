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
let targetSeconds = 0, elapsedSeconds = 0;
let pauseOffsetMs = 0, pauseStartMs = 0, startTime = 0;
let masterInterval = null, presenceTimer = null;
let surpriseProbPerSec = 0, lastSurpriseEndSecond = -999;
let pendingVictory = null;

const stopIfRunning = () => { if (running) declarerEchec("APPLICATION QUITTÉE"); };
document.addEventListener("visibilitychange", () => { if (document.hidden) stopIfRunning(); });
window.addEventListener("pagehide", stopIfRunning);

const dateJour = () => new Date().toISOString().slice(0, 10);
const ecartJours = (d1, d2) => (!d1 || !d2) ? 999 : Math.round((new Date(d2) - new Date(d1)) / 864e5);

function updateStreakData(target, lastKey, streakKey, recordKey, today) {
  if (target[lastKey] !== today) {
    target[streakKey] = ecartJours(target[lastKey], today) === 1 ? target[streakKey] + 1 : 1;
    target[lastKey] = today;
  }
  target[recordKey] = Math.max(target[streakKey], target[recordKey] || 0);
}

function initialiserStructureStats() {
  const defaut = { lastActiveDate: null, dayStreak: 0, dayStreakRecord: 0, bankSeconds: 0, tiers: {} };
  DURATION_TIERS.forEach(t => defaut.tiers[t.id] = { streak: 0, record: 0, lastDate: null });
  return defaut;
}

function initialiserStructureConfig() {
  return {
    selectedTierId: "1m",
    surpriseFreq: "0.011",
    probDist: "linear"
  };
}

function parserEtValiderStats(dataBrute) {
  const defaut = initialiserStructureStats();
  const data = Object.assign(defaut, dataBrute || {});
  const today = dateJour();

  if (ecartJours(data.lastActiveDate, today) > 1) data.dayStreak = 0;
  data.dayStreakRecord = Math.max(data.dayStreak, data.dayStreakRecord || 0);

  DURATION_TIERS.forEach(t => {
    const tier = data.tiers[t.id] = data.tiers[t.id] || { streak: 0, record: 0, lastDate: null };
    if (ecartJours(tier.lastDate, today) > 1) tier.streak = 0;
    tier.record = Math.max(tier.streak, tier.record || 0);
  });
  return data;
}

function chargerDonneesStats() {
  try {
    const raw = localStorage.getItem('meditation_presence_stats');
    if (!raw) return initialiserStructureStats();
    return parserEtValiderStats(JSON.parse(raw));
  } catch {
    return initialiserStructureStats();
  }
}

function enregistrerDonneesStats(data) {
  try {
    localStorage.setItem('meditation_presence_stats', JSON.stringify(data));
  } catch (err) {
    console.error("Erreur d'écriture dans localStorage:", err);
  }
}

function sauvegarderParametres() {
  const conf = {
    selectedTierId,
    surpriseFreq: $('surpriseFreq').value,
    probDist: $('probDist').value
  };

  try {
    localStorage.setItem('meditation_presence_config', JSON.stringify(conf));
  } catch (err) {
    console.error("Erreur d'enregistrement config:", err);
  }
}

function appliquerParametres(config) {
  if (!config) return;
  if (config.selectedTierId && DURATION_TIERS.some(t => t.id === config.selectedTierId)) {
    selectedTierId = config.selectedTierId;
  }
  ['surpriseFreq', 'probDist'].forEach(k => {
    if (config[k] !== undefined && $(k)) $(k).value = config[k];
  });
}

function chargerParametres() {
  try {
    const config = JSON.parse(localStorage.getItem('meditation_presence_config') || '{}');
    appliquerParametres(config);
  } catch {}
}

// --- SYSTÈME D'IMPORT / EXPORT JSON ---

function exporterDonneesJSON() {
  const donnees = {
    version: 1,
    dateExport: new Date().toISOString(),
    stats: chargerDonneesStats(),
    config: {
      selectedTierId,
      surpriseFreq: $('surpriseFreq').value,
      probDist: $('probDist').value
    }
  };

  const blob = new Blob([JSON.stringify(donnees, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = `anti-brainrotting-backup-${dateJour()}.json`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

function declencherImportation() {
  if (running) {
    if (!confirm("Une session est en cours. Importer une sauvegarde annulera la session actuelle. Continuer ?")) {
      return;
    }
    declarerEchec("SESSION RÉINITIALISÉE PAR IMPORT");
  }
  $('fileInputImport').click();
}

function gererFichierImport(event) {
  const fichier = event.target.files?.[0];
  if (!fichier) return;

  const lecteur = new FileReader();
  lecteur.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload || !payload.stats) {
        throw new Error("Format JSON non valide : bloc 'stats' manquant.");
      }

      const statsValidees = parserEtValiderStats(payload.stats);
      enregistrerDonneesStats(statsValidees);

      if (payload.config) {
        appliquerParametres(payload.config);
        sauvegarderParametres();
      }

      gererChangementDistribution();
      rafraichirAffichageStats();
      actualiserBoutonRecommencer();
      alert("Progression restaurée avec succès !");
    } catch (err) {
      alert("Erreur lors de l'import : " + err.message);
    } finally {
      event.target.value = "";
    }
  };
  lecteur.readAsText(fichier);
}

// --- LOGIQUE METIER & PALIERS ---

const getTierActuel = () => DURATION_TIERS.find(t => t.id === selectedTierId) || DURATION_TIERS[0];
const getTierCout = t => Math.round(t.minSec * (t.buyMult || 1.2));

function actualiserBoutonRecommencer() {
  if (running || pendingVictory) return;
  reinitialiserBouton(`COMMENCER\n${formaterTemps(getTierActuel().minSec)}`);
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
  $('statDayStreakRecord').textContent = `Record : ${data.dayStreakRecord || 0} j`;
  $('statBank').textContent = formaterTemps(data.bankSeconds || 0, true);

  const fragment = document.createDocumentFragment();
  DURATION_TIERS.forEach(t => {
    const tData = data.tiers[t.id] || { streak: 0, record: 0, lastDate: null };
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
    fragment.appendChild(box);
  });
  $('tiersContainer').replaceChildren(fragment);

  const isDoneToday = data.tiers[tierObj.id]?.lastDate === today;
  $('bonusInfo').style.display = (!running && !pendingVictory && isDoneToday) ? 'flex' : 'none';
  if (isDoneToday) $('bonusInfo').textContent = `Palier ${tierObj.label} déjà validé`;

  const buySec = $('buySection');
  if (!running && !pendingVictory && !isDoneToday) {
    const cout = getTierCout(tierObj);
    buySec.style.display = 'block';
    $('btnBuyStreak').textContent = `Acheter streak ${tierObj.label}×${tierObj.buyMult || 1.2} (${formaterTemps(cout, true)})`;
    $('btnBuyStreak').disabled = (data.bankSeconds || 0) < cout;
  } else {
    buySec.style.display = 'none';
  }
}

function acheterStreak() {
  if (running || pendingVictory) return;
  const data = chargerDonneesStats();
  const today = dateJour();
  const tier = getTierActuel();
  const cout = getTierCout(tier);

  if ((data.bankSeconds || 0) < cout) return alert("Solde de temps insuffisant.");

  data.bankSeconds -= cout;
  updateStreakData(data, 'lastActiveDate', 'dayStreak', 'dayStreakRecord', today);
  const tData = data.tiers[tier.id] = data.tiers[tier.id] || { streak: 0, record: 0, lastDate: null };
  updateStreakData(tData, 'lastDate', 'streak', 'record', today);

  enregistrerDonneesStats(data);
  rafraichirAffichageStats();
  alert(`Streak ${tier.label} acheté avec succès !`);
}

function traiterRecompenseSession(choix) {
  if (!pendingVictory) return;
  const { dureeReelle, targetTier } = pendingVictory;
  const stats = chargerDonneesStats();
  const today = dateJour();
  let texteResultat = "";

  if (choix === 'streak') {
    updateStreakData(stats, 'lastActiveDate', 'dayStreak', 'dayStreakRecord', today);
    const tData = stats.tiers[targetTier.id] = stats.tiers[targetTier.id] || { streak: 0, record: 0, lastDate: null };
    updateStreakData(tData, 'lastDate', 'streak', 'record', today);
    texteResultat = "STREAK COMPTABILISÉ";
  } else {
    const isSacrifice = choix === 'bank_half';
    const rate = isSacrifice ? targetTier.rateSacrifice : targetTier.rateFull;
    const gain = Math.floor(dureeReelle * rate);
    stats.bankSeconds = (stats.bankSeconds || 0) + gain;
    texteResultat = `+${formaterTemps(gain)} ${isSacrifice ? '(SACRIFICE)' : 'SOLDÉ'}`;
  }

  enregistrerDonneesStats(stats);
  rafraichirAffichageStats();

  const tempsTenu = formaterTemps(dureeReelle);
  pendingVictory = null;
  $('rewardChoiceSection').style.display = 'none';
  $('actionBtn').style.display = 'flex';
  reinitialiserBouton(`GAGNÉ (${tempsTenu})\n${texteResultat}\nRECOMMENCER`);
}

function gererChangementDistribution() {
  const isFixed = $('probDist').value === 'fixed';
  $('surpriseFreq').disabled = !isFixed;
  const surpriseCard = $('rowSurpriseCard');
  if (surpriseCard) {
    surpriseCard.classList.toggle('hidden', !isFixed);
  }
}

function formaterTemps(totalSec, compact = false) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || !parts.length) parts.push(`${s}s`);
  return parts.join(compact ? '' : ' ');
}

function calculerTempsCible(maxSec, mode) {
  if (mode === 'fixed') return maxSec;
  const u = Math.random();
  const mult = mode === 'linear' ? Math.sqrt(u) : u;
  return Math.max(1, Math.floor(mult * (maxSec + 1)));
}

function toggleFormInputs(disabled) {
  $('probDist').disabled = disabled;
  if (disabled) {
    $('surpriseFreq').disabled = true;
    $('buySection').style.display = $('bonusInfo').style.display = 'none';
  } else {
    gererChangementDistribution();
    rafraichirAffichageStats();
  }
}

function handleClick() {
  if (presenceMode === 'mid') {
    clearTimeout(presenceTimer);
    presenceMode = null;
    pauseOffsetMs += (Date.now() - pauseStartMs);
    lastSurpriseEndSecond = elapsedSeconds;

    const btn = $('actionBtn');
    btn.textContent = "ABANDONNER";
    btn.className = "stop";
  } else if (presenceMode === 'final') {
    clearTimeout(presenceTimer);
    presenceMode = null;

    const stats = chargerDonneesStats();
    const targetTier = getTierActuel();
    const alreadyDoneToday = stats.tiers[targetTier.id]?.lastDate === dateJour();

    pendingVictory = { dureeReelle: targetSeconds, targetTier };

    if (!alreadyDoneToday) {
      const gainPotentiel = Math.floor(targetSeconds * targetTier.rateSacrifice);
      $('btnChooseStreak').textContent = `VALIDER SÉRIE ${targetTier.label}`;
      $('btnChooseBank').textContent = `SOLDE TEMPS : +${formaterTemps(gainPotentiel)} (×${targetTier.rateSacrifice})`;
      $('actionBtn').style.display = 'none';
      $('rewardChoiceSection').style.display = 'flex';
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

  const maxTotal = getTierActuel().minSec;
  const distMode = $('probDist').value;

  targetSeconds = calculerTempsCible(maxTotal, distMode);
  surpriseProbPerSec = (distMode === 'fixed') ? (parseFloat($('surpriseFreq').value) || 0) : 0;
  
  elapsedSeconds = 0;
  pauseOffsetMs = 0;
  startTime = Date.now();
  lastSurpriseEndSecond = -999;
  presenceMode = null;
  pendingVictory = null;
  running = true;

  $('rewardChoiceSection').style.display = 'none';
  $('actionBtn').style.display = 'flex';

  toggleFormInputs(true);

  const btn = $('actionBtn');
  btn.textContent = "ABANDONNER";
  btn.className = "stop";

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

  if (surpriseProbPerSec > 0) {
    const delaiEcoule = (elapsedSeconds - lastSurpriseEndSecond) >= 10;
    const pasTropProcheFin = (targetSeconds - elapsedSeconds) > 20;

    if (delaiEcoule && pasTropProcheFin && Math.random() < surpriseProbPerSec) {
      pauseStartMs = Date.now();
      activerCompteARebours('mid', 5, "ATTENTION????", "CONTRÔLE MANQUÉ");
    }
  }
}

function activerCompteARebours(mode, seconds, symbol, failReason) {
  clearTimeout(presenceTimer);
  presenceMode = mode;
  const btn = $('actionBtn');
  btn.textContent = symbol;
  btn.className = "presence";
  presenceTimer = setTimeout(() => {
    if (presenceMode === mode) declarerEchec(failReason);
  }, seconds * 1000);
}

function declarerEchec(raison = "NON VALIDÉ") {
  presenceMode = null;
  running = false;
  pendingVictory = null;
  clearInterval(masterInterval);
  clearTimeout(presenceTimer);

  $('rewardChoiceSection').style.display = 'none';
  $('actionBtn').style.display = 'flex';

  reinitialiserBouton(`PERDU (${formaterTemps(elapsedSeconds)})\n${raison}\nRECOMMENCER`);
}

function reinitialiserBouton(label = "COMMENCER") {
  toggleFormInputs(false);
  const btn = $('actionBtn');
  btn.textContent = label;
  btn.className = "";
}

// Écouteurs d'événements - Import & Export JSON
$('btnExport').addEventListener('click', exporterDonneesJSON);
$('btnImport').addEventListener('click', declencherImportation);
$('fileInputImport').addEventListener('change', gererFichierImport);

// Écouteurs d'événements - Sessions & Récompenses
$('actionBtn').addEventListener('click', handleClick);
$('btnBuyStreak').addEventListener('click', acheterStreak);

$('btnChooseStreak').addEventListener('click', () => traiterRecompenseSession('streak'));
$('btnChooseBank').addEventListener('click', () => traiterRecompenseSession('bank_half'));

$('surpriseFreq').addEventListener('change', sauvegarderParametres);
$('probDist').addEventListener('change', () => {
  gererChangementDistribution();
  sauvegarderParametres();
});

// Initialisation
chargerParametres();
gererChangementDistribution();
rafraichirAffichageStats();
actualiserBoutonRecommencer();
