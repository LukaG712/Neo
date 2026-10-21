const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

let mainWindow = null;
let backendProcess = null;
let proxyServer = null;
let tray = null;

const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");
const BACKEND_PORT = 8000;
const PROXY_PORT = 3001;

function proxyRequest(req, res) {
  const url = req.url || "/";
  const options = {
    hostname: "127.0.0.1",
    port: BACKEND_PORT,
    path: url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[proxy error]", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Backend unavailable");
    }
  });

  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

function createProxyServer() {
  proxyServer = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/api/")) {
      proxyRequest(req, res);
    } else {
      serveStatic(req, res, url);
    }
  });

  proxyServer.listen(PROXY_PORT, "127.0.0.1", () => {
    console.log(`[proxy] listening on http://127.0.0.1:${PROXY_PORT}`);
  });

  proxyServer.on("error", (err) => {
    console.error("[proxy server error]", err);
  });
}

function serveStatic(req, res, requestUrl) {
  let filePath = path.join(FRONTEND_DIST, requestUrl === "/" ? "index.html" : requestUrl);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const distResolved = path.resolve(FRONTEND_DIST);
  if (!resolved.startsWith(distResolved + path.sep) && resolved !== distResolved) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // Fall back to index.html for SPA routing
      const indexPath = path.join(FRONTEND_DIST, "index.html");
      fs.readFile(indexPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    fs.createReadStream(resolved).pipe(res);
  });
}

function createTray() {
  // Create tray icon
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  let trayIcon = null;
  
  // Fallback: create a simple icon if not found
  if (fs.existsSync(iconPath)) {
    trayIcon = iconPath;
  }
  
  tray = new Tray(trayIcon || createFallbackIcon());
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Neo",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          if (process.platform === "darwin") {
            app.dock.show();
          }
        }
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip("Neo");
  tray.setContextMenu(contextMenu);
  
  tray.on("click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        if (process.platform === "darwin") {
          app.dock.show();
        }
      }
    }
  });
}

function createFallbackIcon() {
  // Create a simple 16x16 PNG icon in memory
  const { nativeImage } = require("electron");
  const image = nativeImage.createEmpty();
  return image;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Neo",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
    if (process.platform === "darwin") {
      app.dock.hide();
    }
  });

  // Create system tray
  createTray();

  // Start the Python backend
  const startBackend = () => {
    const backendPath = path.join(__dirname, "..", "backend", "app", "__main__.py");
    const python = process.platform === "win32" ? "python" : "python3";
    backendProcess = spawn(python, [backendPath], {
      cwd: path.join(__dirname, "..", "backend"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LACC_HOST: "127.0.0.1",
        LACC_PORT: "8000",
        LACC_DATABASE_URL: "sqlite:///./data/Neo.db",
        LACC_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      },
    });

    backendProcess.stdout.on("data", (data) => {
      console.log(`[Neo-backend] ${data}`);
    });
    backendProcess.stderr.on("data", (data) => {
      console.error(`[Neo-backend err] ${data}`);
    });

    backendProcess.on("exit", (code) => {
      console.log(`[Neo-backend] exited with code ${code}`);
      backendProcess = null;
    });
  };

  startBackend();
  createProxyServer();

  // Wait for backend and proxy to be ready, then load the frontend
  setTimeout(() => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${PROXY_PORT}`);
    }
  }, 2500);

  ipcMain.handle("open-external", async (event, targetUrl) => {
    await shell.openExternal(targetUrl);
  });

  ipcMain.handle("quit-app", () => {
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
  if (proxyServer) {
    proxyServer.close();
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});