// AGOA DGD — suivi financier des chantiers — processus principal (Electron)
// Les données sont dans UN fichier JSON choisi par l'utilisateur (par ex. dans Dropbox).
// Un fichier « .lock » voisin signale qu'un poste a l'application ouverte sur ce fichier.
// Mises à jour : Releases GitHub agence-rt/agoa-dgd (comme AGOA PV).

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const pkg = require("./package.json");
const INFO = { version: pkg.version, deploiement: (pkg.agoa && pkg.agoa.deploiement) || 0 };

const ME = { user: os.userInfo().username, host: os.hostname() };
const HEARTBEAT_MS = 60 * 1000;      // le verrou est rafraîchi chaque minute
const LOCK_STALE_MS = 3 * 60 * 1000; // au-delà de 3 min sans rafraîchissement, le verrou est périmé
const BACKUPS_KEPT = 30;

let win = null;
let dataPath = null;
let lastWritten = null;   // contenu exact de notre dernière écriture
let heartbeat = null;
let holdsLock = false;
let backedUpThisSession = new Set();
// Variables de test (non utilisées en usage normal)
const TEST_DATA = process.env.SF_TEST_DATA || null;
const TEST_OUT = process.env.SF_TEST_OUT || null;
const TEST_SAVEAS = process.env.SF_TEST_SAVEAS || null;

/* ---------- configuration locale (dernier fichier ouvert) ---------- */
const cfgFile = () => path.join(app.getPath("userData"), "config.json");
function readCfg() {
  try { return JSON.parse(fs.readFileSync(cfgFile(), "utf8")); }
  catch {
    // reprise de l'ancienne version « Suivi financier des chantiers » (autre dossier de configuration)
    try { return JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), "Suivi financier des chantiers", "config.json"), "utf8")); }
    catch { return {}; }
  }
}
function writeCfg(c) { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1)); } catch {} }

/* ---------- verrou ---------- */
const lockPath = () => dataPath + ".lock";
function readLock() {
  try {
    const l = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
    if (!l || !l.at) return null;
    if (Date.now() - new Date(l.at).getTime() > LOCK_STALE_MS) return null;
    if (l.host === ME.host && l.user === ME.user) return null; // c'est nous
    return l;
  } catch { return null; }
}
function writeLock() {
  if (!dataPath) return;
  try { fs.writeFileSync(lockPath(), JSON.stringify({ ...ME, at: new Date().toISOString() })); } catch {}
}
function takeLock() {
  holdsLock = true; writeLock();
  clearInterval(heartbeat); heartbeat = setInterval(writeLock, HEARTBEAT_MS);
}
function releaseLock() {
  clearInterval(heartbeat); heartbeat = null;
  if (holdsLock && dataPath) {
    try {
      const l = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
      if (l.host === ME.host && l.user === ME.user) fs.unlinkSync(lockPath());
    } catch {}
  }
  holdsLock = false;
}

/* ---------- sauvegardes locales de sécurité ---------- */
function backup() {
  if (!dataPath || backedUpThisSession.has(dataPath) || !fs.existsSync(dataPath)) return;
  try {
    const dir = path.join(app.getPath("userData"), "sauvegardes");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fs.copyFileSync(dataPath, path.join(dir, `${path.basename(dataPath, ".json")}_${stamp}.json`));
    const all = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
    while (all.length > BACKUPS_KEPT) fs.unlinkSync(path.join(dir, all.shift()));
    backedUpThisSession.add(dataPath);
  } catch {}
}

/* ---------- surveillance des changements faits par Dropbox ---------- */
function watch(p) { fs.watchFile(p, { interval: 3000 }, onFileChange); }
function unwatch(p) { if (p) fs.unwatchFile(p, onFileChange); }
function onFileChange(curr, prev) {
  if (!dataPath || curr.mtimeMs === prev.mtimeMs) return;
  let txt; try { txt = fs.readFileSync(dataPath, "utf8"); } catch { return; }
  if (txt === lastWritten) return;
  let parsed; try { parsed = JSON.parse(txt); } catch { return; } // fichier en cours de synchronisation
  if (win) win.webContents.send("data:changed", parsed);
}

function setDataPath(p) {
  if (dataPath === p) return;
  releaseLock(); unwatch(dataPath);
  dataPath = p; lastWritten = null;
  const c = readCfg(); c.lastFile = p;
  c.recent = [p, ...(c.recent || (c.lastFile ? [c.lastFile] : [])).filter(x => x && path.resolve(x).toLowerCase() !== path.resolve(p).toLowerCase())].slice(0, 12);
  writeCfg(c);
  watch(p);
}

const EXT = ".dgd";
const OPEN_FILTERS = [{ name: "Dossiers AGOA DGD", extensions: ["dgd", "json"] }];
const SAVE_FILTERS = [{ name: "Dossier AGOA DGD", extensions: ["dgd"] }];
const isDataFile = f => typeof f === "string" && /\.(dgd|json)$/i.test(f) && fs.existsSync(f);
const fileFromArgv = argv => (argv || []).slice(1).find(a => !a.startsWith("-") && isDataFile(a)) || null;
const withExt = f => /\.dgd$/i.test(f) ? f : f.replace(/\.json$/i, "") + EXT;
const emptyData = () => JSON.stringify({ format: "agoa-dgd", version: 1, savedAt: new Date().toISOString(), projects: {} }, null, 1);
function defaultDir() {
  const dbx = path.join(os.homedir(), "Dropbox");
  return fs.existsSync(dbx) ? dbx : app.getPath("documents");
}

/* ---------- fenêtre ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: `AGOA DGD — v${INFO.version}`, show: false,
    icon: path.join(__dirname, "build", "icon.ico"),
    backgroundColor: "#FFFFFF",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.once("ready-to-show", revealMain);
  if (process.env.SF_TEST_SCRIPT) {
    win.webContents.once("did-finish-load", async () => {
      try { await win.webContents.executeJavaScript(fs.readFileSync(process.env.SF_TEST_SCRIPT, "utf8")); }
      catch (e) { console.error("TEST ERROR", e); }
      const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(TEST_OUT, "screen.png"), img.toPNG());
      fs.writeFileSync(path.join(TEST_OUT, "title.txt"), win.getTitle() + "\n" + await win.webContents.executeJavaScript("document.title"));
      app.quit();
    });
  }
  // liens externes dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

const menu = Menu.buildFromTemplate([
  { label: "Fichier", submenu: [
    { label: "Ouvrir…", accelerator: "CmdOrCtrl+O", click: () => win && win.webContents.send("menu:change-file") },
    { label: "Enregistrer sous…", accelerator: "CmdOrCtrl+Shift+S", click: () => win && win.webContents.send("menu:save-as") },
    { label: "Fermer le dossier (accueil)", accelerator: "CmdOrCtrl+W", click: () => win && win.webContents.send("menu:close") },
    { type: "separator" },
    { label: "Afficher le fichier dans l'Explorateur", click: () => dataPath && shell.showItemInFolder(dataPath) },
    { label: "Ouvrir le dossier des sauvegardes", click: () => { const d = path.join(app.getPath("userData"), "sauvegardes"); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); } },
    { type: "separator" },
    { role: "quit", label: "Quitter" }
  ]},
  { label: "Affichage", submenu: [
    { role: "reload", label: "Recharger" },
    { type: "separator" },
    { role: "resetZoom", label: "Taille réelle" },
    { role: "zoomIn", label: "Zoom avant" },
    { role: "zoomOut", label: "Zoom arrière" },
    { type: "separator" },
    { role: "togglefullscreen", label: "Plein écran" }
  ]},
  { label: "Aide", submenu: [
    { label: "Rechercher une mise à jour", click: manualUpdateCheck },
    { type: "separator" },
    { label: `AGOA DGD v${INFO.version} — déploiement n°${INFO.deploiement}`, enabled: false }
  ]}
]);

/* ---------- échanges avec l'interface ---------- */
ipcMain.handle("data:state", () => {
  if (!dataPath && TEST_DATA) setDataPath(TEST_DATA);
  return readState();
});

function recentList() {
  const c = readCfg();
  const list = c.recent || (c.lastFile ? [c.lastFile] : []);
  return list.map(f => {
    let st = null; try { st = fs.statSync(f); } catch {}
    return { path: f, name: path.basename(f), dir: path.dirname(f), exists: !!st, mtime: st ? st.mtimeMs : null };
  });
}
function readState() {
  if (!dataPath) return { path: null, recent: recentList() };
  let content = null, error = null;
  try { content = JSON.parse(fs.readFileSync(dataPath, "utf8")); }
  catch (e) { error = fs.existsSync(dataPath) ? "Le fichier de données est illisible (synchronisation en cours ?)." : "Fichier introuvable."; }
  return { path: dataPath, name: path.basename(dataPath), content, error, lock: readLock(), me: ME };
}

ipcMain.handle("data:choose", async (_e, mode) => {
  if (mode === "create") {
    const r = await dialog.showSaveDialog(win, {
      title: "Créer le fichier de données",
      defaultPath: path.join(defaultDir(), "suivi-financier" + EXT),
      filters: SAVE_FILTERS
    });
    if (r.canceled || !r.filePath) return null;
    const f = withExt(r.filePath);
    fs.writeFileSync(f, emptyData(), "utf8");
    setDataPath(f);
  } else {
    const r = await dialog.showOpenDialog(win, {
      title: "Ouvrir un fichier de données",
      defaultPath: defaultDir(),
      properties: ["openFile"],
      filters: OPEN_FILTERS
    });
    if (r.canceled || !r.filePaths[0]) return null;
    setDataPath(r.filePaths[0]);
  }
  return readState();
});

ipcMain.handle("data:recent", () => recentList());
ipcMain.handle("data:forget", (_e, f) => { const c = readCfg(); c.recent = (c.recent || []).filter(x => x !== f); writeCfg(c); return recentList(); });
// Fermer le dossier : retour à l'accueil
ipcMain.handle("data:close", () => { releaseLock(); unwatch(dataPath); dataPath = null; lastWritten = null; return readState(); });
// Ouvrir un fichier précis (double-clic sur un .dgd alors que l'application est déjà lancée)
ipcMain.handle("data:open-path", (_e, f) => { if (!isDataFile(f)) return null; setDataPath(f); return readState(); });

// Enregistrer sous : copie du dossier courant au format .dgd (avec ses PDF), puis on travaille sur la copie
ipcMain.handle("data:save-as", async (_e, obj) => {
  const base = dataPath ? path.join(path.dirname(dataPath), path.basename(dataPath, path.extname(dataPath)) + EXT) : path.join(defaultDir(), "suivi-financier" + EXT);
  const r = TEST_SAVEAS ? { filePath: TEST_SAVEAS } : await dialog.showSaveDialog(win, { title: "Enregistrer sous", defaultPath: base, filters: SAVE_FILTERS });
  if (r.canceled || !r.filePath) return null;
  const f = withExt(r.filePath);
  if (dataPath && path.resolve(f).toLowerCase() === path.resolve(dataPath).toLowerCase()) return readState();
  try {
    const oldPdf = pdfDir();
    const txt = JSON.stringify({ format: "agoa-dgd", version: 1, savedAt: new Date().toISOString(), savedBy: ME, projects: obj.projects }, null, 1);
    fs.writeFileSync(f, txt, "utf8");
    const newPdf = pdfDirFor(f);
    if (oldPdf && fs.existsSync(oldPdf) && path.resolve(oldPdf) !== path.resolve(newPdf)) fs.cpSync(oldPdf, newPdf, { recursive: true, force: false, errorOnExist: false });
    setDataPath(f); lastWritten = txt; takeLock();
    return readState();
  } catch (e) { return { path: null, error: "Enregistrement impossible : " + e.message }; }
});

ipcMain.handle("data:take-lock", () => { takeLock(); return true; });

ipcMain.handle("data:write", (_e, obj) => {
  if (!dataPath) return { ok: false, error: "Aucun fichier de données." };
  try {
    backup();
    const txt = JSON.stringify({ format: "agoa-dgd", version: 1, savedAt: new Date().toISOString(), savedBy: ME, projects: obj.projects }, null, 1);
    const tmp = path.join(path.dirname(dataPath), "." + path.basename(dataPath) + ".tmp");
    fs.writeFileSync(tmp, txt, "utf8");
    fs.renameSync(tmp, dataPath);           // écriture atomique : jamais de fichier à moitié écrit
    lastWritten = txt;
    if (holdsLock) writeLock();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("file:save", async (_e, { defaultName, data, filters }) => {
  const r = TEST_OUT ? { filePath: path.join(TEST_OUT, defaultName) } : await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), defaultName), filters });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, Buffer.from(data)); if (!TEST_OUT) shell.showItemInFolder(r.filePath); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("pdf:print", async (_e, { defaultName, footerLeft, scale }) => {
  const r = TEST_OUT ? { filePath: path.join(TEST_OUT, defaultName) } : await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), defaultName), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  try {
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4", landscape: false, printBackground: true, scale: scale || 0.62,
      margins: { top: 0.45, bottom: 0.6, left: 0.47, right: 0.47 },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:8px;color:#6b7478;padding:0 12mm;display:flex;justify-content:space-between">
        <span>${esc(footerLeft || "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
    });
    fs.writeFileSync(r.filePath, pdf);
    if (!TEST_OUT) shell.openPath(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ---------- écran de démarrage (identique à AGOA PV) ---------- */
let splash = null, splashAt = 0;
function showSplash() {
  splash = new BrowserWindow({ width: 520, height: 330, frame: false, resizable: false, movable: true, center: true, show: false,
    skipTaskbar: false, alwaysOnTop: true, backgroundColor: "#FFFFFF", title: "AGOA DGD", icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  splash.loadFile(path.join(__dirname, "app", "splash.html"), { query: { v: INFO.version, d: String(INFO.deploiement) } });
  splash.once("ready-to-show", () => { splash.show(); splashAt = Date.now(); });
}
function splashStatus(text, pct = null) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(`window.setStatus && setStatus(${JSON.stringify(text)}, ${pct == null ? "null" : Math.round(pct)})`).catch(() => {});
  if (process.env.SF_TEST_SPLASH && TEST_OUT) setTimeout(async () => {
    if (!splash || splash.isDestroyed()) return;
    fs.writeFileSync(path.join(TEST_OUT, "splash.png"), (await splash.webContents.capturePage()).toPNG());
  }, 400);
}
function closeSplash() { if (splash && !splash.isDestroyed()) splash.close(); splash = null; }
let revealed = false, mainReady = false, startupFinished = false;
function revealMain() {
  mainReady = true;
  if (!startupFinished || revealed || !win) return;
  revealed = true;
  const wait = Math.max(0, 1800 - (Date.now() - (splashAt || Date.now()))); // le logo reste au moins 1,8 s
  setTimeout(() => {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    closeSplash(); phase = "running";
  }, wait);
}

/* ---------- mises à jour (Releases GitHub agence-rt/agoa-dgd) ---------- */
// Au démarrage : vérification pendant l'écran de démarrage, puis installation automatique et relance.
// En cours d'utilisation : « Aide › Rechercher une mise à jour » propose la mise à jour.
let updater = null;
let phase = "splash";       // splash | running
let updateState = "idle";   // idle | checking | proposed | downloading | ready
let startupDone = null;
let pendingVersion = "";
let manualCheck = false;
const notesText = info => {
  const n = info && info.releaseNotes;
  const t = Array.isArray(n) ? n.map(x => x.note || "").join("\n") : (n || "");
  return String(t).replace(/<[^>]+>/g, "").trim();
};
function startDownload() {
  updateState = "downloading";
  updater.downloadUpdate().catch(err => {
    updateState = "idle";
    if (phase === "splash") { splashStatus("Échec du téléchargement — démarrage de la version actuelle…"); setTimeout(() => startupDone && startupDone("none"), 1500); return; }
    win.setProgressBar(-1); win.setTitle(`AGOA DGD — v${INFO.version}`);
    dialog.showErrorBox("Mise à jour", "Le téléchargement a échoué : " + (err && err.message ? err.message : err));
  });
}
async function proposeUpdate(info) {
  if (updateState === "downloading" || updateState === "ready") return;
  updateState = "proposed";
  const notes = notesText(info);
  const r = await dialog.showMessageBox(win, {
    type: "info", buttons: ["Mettre à jour maintenant", "Plus tard"], defaultId: 0, cancelId: 1, noLink: true,
    title: "Mise à jour disponible", message: `AGOA DGD ${info.version} est disponible.`,
    detail: `Version installée : ${INFO.version} (déploiement n°${INFO.deploiement}).` + (notes ? `\n\nNouveautés :\n${notes}` : "") +
      "\n\nLa mise à jour se télécharge puis l'application redémarre. Votre fichier de données et vos PDF ne sont pas modifiés."
  });
  if (r.response !== 0) { updateState = "idle"; return; }
  win.setTitle(`AGOA DGD — téléchargement de la mise à jour ${info.version}…`);
  startDownload();
}
function initUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("update-available", info => {
      pendingVersion = info.version;
      if (phase === "splash") { splashStatus(`Mise à jour ${info.version} disponible — téléchargement…`, 0); startDownload(); }
      else proposeUpdate(info);
    });
    updater.on("update-not-available", () => {
      if (phase === "splash" && startupDone) startupDone("none");
      else if (manualCheck) { manualCheck = false; dialog.showMessageBox(win, { type: "info", noLink: true, title: "Mise à jour", message: "AGOA DGD est à jour.", detail: `Version ${INFO.version} (déploiement n°${INFO.deploiement}).` }); }
    });
    updater.on("download-progress", p => {
      if (phase === "splash") splashStatus(`Téléchargement de la mise à jour ${pendingVersion}… ${Math.round(p.percent)} %`, p.percent);
      else if (win) { win.setProgressBar(p.percent / 100); win.setTitle(`AGOA DGD — téléchargement de la mise à jour… ${Math.round(p.percent)} %`); }
    });
    updater.on("update-downloaded", () => {
      updateState = "ready";
      const install = () => { releaseLock(); setTimeout(() => updater.quitAndInstall(true, true), 900); }; // installation silencieuse puis relance
      if (phase === "splash") { splashStatus(`Installation de la version ${pendingVersion}… AGOA DGD va redémarrer`, 100); install(); return; }
      if (win) win.setProgressBar(-1);
      win.webContents.executeJavaScript("typeof flushSave === 'function' ? flushSave() : null").catch(() => {}).finally(install);
    });
    updater.on("error", err => {
      console.warn("Mise à jour :", err && err.message);
      if (updateState === "checking") updateState = "idle";
      if (phase === "splash" && updateState !== "downloading" && startupDone) startupDone("none");
      else if (manualCheck) { manualCheck = false; dialog.showErrorBox("Mise à jour", "La recherche de mise à jour a échoué. Vérifiez la connexion Internet."); }
    });
  } catch (e) { console.warn(e); updater = null; }
}
function startupUpdateCheck() {
  if (!updater) return Promise.resolve("none");
  return new Promise(resolve => {
    let done = false;
    startupDone = r => { if (!done) { done = true; resolve(r); } };
    splashStatus("Recherche de mise à jour…");
    updateState = "checking";
    // Hors connexion ou GitHub lent : on démarre au bout de 6 s (sauf si un téléchargement a commencé)
    setTimeout(() => { if (updateState !== "downloading" && updateState !== "ready") startupDone("none"); }, 6000);
    updater.checkForUpdates().then(r => { if (r && r.isUpdateAvailable === false) startupDone("none"); }).catch(() => startupDone("none"));
  }).then(r => { if (updateState === "checking") updateState = "idle"; return r; });
}
function manualUpdateCheck() {
  if (!updater) { dialog.showMessageBox(win, { type: "info", noLink: true, title: "Mise à jour", message: "Recherche indisponible", detail: "La recherche de mise à jour ne fonctionne que dans l'application installée." }); return; }
  if (updateState !== "idle") return;
  manualCheck = true; updateState = "checking";
  updater.checkForUpdates().then(() => { if (updateState === "checking") updateState = "idle"; }).catch(() => { updateState = "idle"; });
}

/* ---------- pièces jointes PDF (dossier voisin du fichier de données) ---------- */
const pdfDirFor = f => path.join(path.dirname(f), path.basename(f, path.extname(f)) + " - PDF");
const pdfDir = () => dataPath ? pdfDirFor(dataPath) : null;
const okId = id => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
ipcMain.handle("pdf:save", (_e, { name, data }) => {
  const dir = pdfDir(); if (!dir) return { ok: false, code: "quota_or_state" };
  const buf = Buffer.from(data);
  if (buf.length > 20 * 1024 * 1024) return { ok: false, code: "too_large" };
  if (buf.slice(0, 5).toString("latin1") !== "%PDF-") return { ok: false, code: "unsupported_type" };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(dir, id + ".pdf"), buf);
    return { ok: true, id, size: buf.length };
  } catch (e) { return { ok: false, code: "upstream_error", error: e.message }; }
});
ipcMain.handle("pdf:read", (_e, id) => {
  if (!okId(id) || !pdfDir()) return null;
  try { return new Uint8Array(fs.readFileSync(path.join(pdfDir(), id + ".pdf"))); } catch { return null; }
});
ipcMain.handle("pdf:delete", async (_e, id) => {
  if (!okId(id) || !pdfDir()) return { deleted: false };
  const f = path.join(pdfDir(), id + ".pdf");
  try { await shell.trashItem(f); return { deleted: true }; } catch { return { deleted: false }; }
});
ipcMain.handle("pdf:open", (_e, id) => {
  if (!okId(id) || !pdfDir()) return false;
  const f = path.join(pdfDir(), id + ".pdf");
  if (!fs.existsSync(f)) return false;
  shell.openPath(f); return true;
});

/* ---------- cycle de vie ---------- */
const single = app.requestSingleInstanceLock();
if (!single) { app.quit(); }
else {
  app.on("second-instance", (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore(); win.focus();
    const f = fileFromArgv(argv);
    if (f) win.webContents.send("menu:open-path", f);
  });
  { const f = fileFromArgv(process.argv); if (f) app.whenReady().then(() => setDataPath(f)); }
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(menu);
    showSplash();
    initUpdater();
    const r = await startupUpdateCheck();
    if (r !== "none") return;            // une mise à jour s'installe : l'application redémarre
    splashStatus("Démarrage…");
    startupFinished = true;
    createWindow();
    if (mainReady) revealMain();
  });
  app.on("before-quit", releaseLock);
  app.on("window-all-closed", () => { releaseLock(); app.quit(); });
}
