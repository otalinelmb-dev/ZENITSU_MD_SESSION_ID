const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const express = require('express');
const path = require('path');
const pino = require('pino');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '/index.html')));

// --- ÉTAPE A : GÉNÉRATION DU CODE DE JUMELAGE ---
app.get('/pairing', async (req, res) => {
    let num = req.query.code;
    if (!num) return res.send({ error: "Numéro requis" });
    const authFolder = `./temp_auth_${Date.now()}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const socket = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });
    if (!socket.authState.creds.registered) {
        await delay(2000);
        const code = await socket.requestPairingCode(num.replace(/[^0-9]/g, ''));
        res.send({ code: code });
    }
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async (s) => {
        if (s.connection === 'open') {
            const creds = fs.readFileSync(`${authFolder}/creds.json`);
            const session = Buffer.from(creds).toString('base64');
            await socket.sendMessage(socket.user.id, { text: `ZENITSU_MD_${session}` });
            await fs.remove(authFolder);
        }
    });
});

// --- ÉTAPE B : ACTIVATION DU BOT ---
app.get('/activate', async (req, res) => {
    const session = req.query.session;
    if (!session || !session.startsWith("ZENITSU_MD_")) return res.send("Session invalide.");
    
    // Ici, le bot démarre réellement
    startZenitsu(session);
    res.send("ZENITSU_MD activé avec succès !");
});

async function startZenitsu(sessionStr) {
    const sessionData = Buffer.from(sessionStr.replace("ZENITSU_MD_", ""), 'base64').toString();
    const liveDir = `./session_active`;
    await fs.ensureDir(liveDir);
    await fs.writeJson(`${liveDir}/creds.json`, JSON.parse(sessionData));

    const { state, saveCreds } = await useMultiFileAuthState(liveDir);
    const client = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    });

    client.ev.on('creds.update', saveCreds);
    client.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            client.sendMessage(client.user.id, { text: "⚡ *ZENITSU_MD CONNECTÉ !*\nTapez .menu pour commencer." });
        }
    });

    // --- SYSTÈME DE COMMANDES (À REMPLIR) ---
    client.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (text.startsWith(".menu")) {
            await client.sendMessage(msg.key.remoteJid, { text: "⚡ *ZENITSU_MD MENU* ⚡\n\n- .antilink\n- .kick\n- .ai\n- .ping" });
        }
        if (text.startsWith(".ping")) {
            await client.sendMessage(msg.key.remoteJid, { text: "Vitesse de l'éclair : 12ms ⚡" });
        }
    });
}

app.listen(PORT, () => console.log("Serveur ZENITSU_MD UP !"));
