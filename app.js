// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = window.APP_CONFIG?.SUPABASE_URL || "https://esfnsfjmbfmlqihnhzyu.supabase.co";
const SUPABASE_ANON_KEY = window.APP_CONFIG?.SUPABASE_ANON_KEY || "sb_publishable_xhIks927TYl0cvBmlDqQkQ_5wkEbmZv";

const supabaseClient = (window.supabase && SUPABASE_URL !== "VOTRE_SUPABASE_URL_ICI")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = null;
let authMode = "login";
let isCloudSynced = false;

const $ = id => document.getElementById(id);

// --- INDICATEUR D'ÉTAT DE SYNCHRONISATION ---
function majIndicateurSync(etat, message) {
  const el = $('cloudSyncStatus');
  if (!el) return;
  switch (etat) {
    case 'saving':
      el.textContent = "ENREGISTREMENT CLOUD...";
      break;
    case 'synced':
      el.textContent = `SYNCHRONISÉ (${message || new Date().toLocaleTimeString()})`;
      break;
    case 'error':
      el.textContent = `HORS LIGNE`;
      break;
    case 'offline':
    default:
      el.textContent = "MODE LOCAL (NON CONNECTÉ)";
      break;
  }
}

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

async function sauvegarderVersSupabase(payload) {
  if (!supabaseClient || !currentUser || !isCloudSynced) return;
  majIndicateurSync('saving');

  try {
    const dataToSave = {
      id: currentUser.id,
      updated_at: new Date().toISOString(),
      ...payload
    };

    const { error } = await supabaseClient
      .from('user_progress')
      .upsert(dataToSave, { onConflict: 'id' });

    if (error) throw error;
    majIndicateurSync('synced');
  } catch (err) {
    console.error("Erreur écriture cloud:", err);
    majIndicateurSync('error', err.message || "Réseau");
  }
}

async function enregistrerDonneesStats(data) {
  try {
    localStorage.setItem('meditation_presence_stats', JSON.stringify(data));
  } catch {}

  await sauvegarderVersSupabase({ stats: data });
}

async function sauvegarderParametres() {
  const conf = {
    selectedTierId,
    surpriseFreq: $('surpriseFreq').value,
    probDist: $('probDist').value
  };

  try {
    localStorage.setItem('meditation_presence_config', JSON.stringify(conf));
  } catch {}

  await sauvegarderVersSupabase({ config: conf });
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

async function synchroniserDepuisCloud() {
  if (!supabaseClient || !currentUser) {
    majIndicateurSync('offline');
    return;
  }

  majIndicateurSync('saving');

  try {
    const { data, error } = await supabaseClient
      .from('user_progress')
      .select('stats, config')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data && (data.stats || data.config)) {
      const stats = data.stats ? parserEtValiderStats(data.stats) : initialiserStructureStats();
      localStorage.setItem('meditation_presence_stats', JSON.stringify(stats));

      const config = data.config || initialiserStructureConfig();
      localStorage.setItem('meditation_presence_config', JSON.stringify(config));
      appliquerParametres(config);
    } else {
      const statsVierges = initialiserStructureStats();
      const configDefaut = initialiserStructureConfig();

      localStorage.setItem('meditation_presence_stats', JSON.stringify(statsVierges));
      localStorage.setItem('meditation_presence_config', JSON.stringify(configDefaut));
      appliquerParametres(configDefaut);

      await supabaseClient.from('user_progress').upsert({
        id: currentUser.id,
        stats: statsVierges,
        config: configDefaut,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    }

    isCloudSynced = true;
    majIndicateurSync('synced', 'À jour');
    gererChangementDistribution();
    rafraichirAffichageStats();
    actualiserBoutonRecommencer();
  } catch (err) {
    console.error("Erreur chargement cloud:", err);
    majIndicateurSync('error', err.message || "Impossible de charger");
  }
}

// --- MODALE & AUTHENTIFICATION (OPTION B : SUPABASE AUTH NATIF) ---

function fermerModal() {
  if ($('authModal')) $('authModal').classList.add('hidden');
}

function ouvrirModal(mode) {
  authMode = mode;
  const isRegister = mode === "register";

  if ($('modalTitle')) {
    $('modalTitle').textContent = isRegister ? "Créer un compte" : "Connexion";
  }

  const emailInput = $('modalEmail');
  const userInput = $('modalUsername');
  const passInput = $('modalPassword');

  if (emailInput) {
    emailInput.value = "";
    emailInput.placeholder = "Adresse e-mail";
  }

  if (userInput) {
    userInput.value = "";
    userInput.classList.toggle('hidden', !isRegister);
    userInput.placeholder = "Pseudo d'affichage";
  }

  if (passInput) passInput.value = "";

  if ($('authModal')) {
    $('authModal').classList.remove('hidden');
    if (emailInput) emailInput.focus();
  }
}

async function soumettreAuthentification() {
  if (!supabaseClient) return alert("Supabase non connecté.");

  const isRegister = authMode === "register";
  const email = $('modalEmail') ? $('modalEmail').value.trim().toLowerCase() : "";
  const username = $('modalUsername') ? $('modalUsername').value.trim() : "";
  const password = $('modalPassword') ? $('modalPassword').value : "";

  if (password.length < 6) {
    return alert("Le mot de passe doit comporter au moins 6 caractères (requis par Supabase).");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return alert("Veuillez renseigner une adresse e-mail valide.");
  }

  majIndicateurSync('saving');

  if (isRegister) {
    // 1. Validation du pseudo
    if (username.length < 2 || username.length > 25) {
      majIndicateurSync('offline');
      return alert("Le pseudo doit contenir entre 2 et 25 caractères.");
    }

    // 2. Inscription native Supabase Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { username } // Stocké directement dans les métadonnées de l'utilisateur
      }
    });

    if (authError) {
      majIndicateurSync('error', authError.message);
      return alert("Erreur création : " + authError.message);
    }

    const user = authData.user;
    if (!user) {
      majIndicateurSync('offline');
      return alert("Vérifiez vos e-mails pour confirmer l'inscription.");
    }

    // 3. Création du profil public
    await supabaseClient.from('profiles').upsert({
      id: user.id,
      username: username
    });

    // 4. Initialisation des progrès
    const statsVierges = initialiserStructureStats();
    const configDefaut = initialiserStructureConfig();

    await supabaseClient.from('user_progress').upsert({
      id: user.id,
      stats: statsVierges,
      config: configDefaut,
      updated_at: new Date().toISOString()
    });

    currentUser = { id: user.id, username };
    gererEtatSession();
    fermerModal();
    await synchroniserDepuisCloud();

  } else {
    // Connexion native Supabase Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (authError || !authData.user) {
      majIndicateurSync('offline');
      return alert("Adresse e-mail ou mot de passe incorrect.");
    }

    const user = authData.user;

    // Récupération du pseudo dans profiles (ou métadonnées de secours)
    let pseudo = user.user_metadata?.username;
    if (!pseudo) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();
      pseudo = profile?.username || email.split('@')[0];
    }

    currentUser = { id: user.id, username: pseudo };
    gererEtatSession();
    fermerModal();
    await synchroniserDepuisCloud();
  }
}

async function deconnecterUtilisateur() {
  if (running) {
    clearInterval(masterInterval);
    clearTimeout(presenceTimer);
    running = false;
    presenceMode = null;
    pendingVictory = null;
  }

  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }

  isCloudSynced = false;
  currentUser = null;
  localStorage.removeItem('meditation_presence_stats');
  localStorage.removeItem('meditation_presence_config');

  selectedTierId = "1m";
  appliquerParametres(initialiserStructureConfig());
  gererChangementDistribution();
  rafraichirAffichageStats();
  actualiserBoutonRecommencer();
  $('rewardChoiceSection').style.display = 'none';
  $('actionBtn').style.display = 'flex';

  majIndicateurSync('offline');
  gererEtatSession();
}

async function initialiserAuth() {
  if (!supabaseClient) {
    majIndicateurSync('offline');
    gererEtatSession();
    return;
  }

  // Écouteur en direct de l'état d'authentification Supabase
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      let pseudo = session.user.user_metadata?.username;
      if (!pseudo) {
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .maybeSingle();
        pseudo = profile?.username || session.user.email?.split('@')[0] || "UTILISATEUR";
      }

      currentUser = { id: session.user.id, username: pseudo };
      gererEtatSession();
      await synchroniserDepuisCloud();
    } else {
      currentUser = null;
      gererEtatSession();
      majIndicateurSync('offline');
    }
  });

  // Récupération de la session existante au chargement
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    majIndicateurSync('offline');
    gererEtatSession();
  }
}

function gererEtatSession() {
  const btnLogin = $('btnLogin');
  const btnRegister = $('btnRegister');
  const btnLogout = $('btnLogout');

  if (currentUser) {
    btnLogin.classList.add('hidden');
    btnRegister.classList.add('hidden');
    btnLogout.classList.remove('hidden');
    btnLogout.textContent = `DÉCONNEXION (${(currentUser.username || '').toUpperCase()})`;
  } else {
    btnLogin.classList.remove('hidden');
    btnRegister.classList.remove('hidden');
    btnLogout.classList.add('hidden');
  }
}

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

  $('statDayStreak').textContent = `${data.dayStreak} j`;
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

async function acheterStreak() {
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

  await enregistrerDonneesStats(data);
  rafraichirAffichageStats();
  alert(`Streak ${tier.label} acheté avec succès !`);
}

async function traiterRecompenseSession(choix) {
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

  await enregistrerDonneesStats(stats);
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

// Écouteurs d'événements - Authentification
$('btnRegister').addEventListener('click', () => ouvrirModal('register'));
$('btnLogin').addEventListener('click', () => ouvrirModal('login'));
$('btnLogout').addEventListener('click', deconnecterUtilisateur);

if ($('btnModalCancel')) $('btnModalCancel').addEventListener('click', fermerModal);
if ($('btnModalSubmit')) $('btnModalSubmit').addEventListener('click', soumettreAuthentification);
if ($('modalPassword')) {
  $('modalPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') soumettreAuthentification();
  });
}

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
initialiserAuth();
