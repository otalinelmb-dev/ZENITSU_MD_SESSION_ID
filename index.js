const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
    fetchLatestBaileysVersion, 
    Browsers 
} = require("@whiskeysockets/baileys");
const express = require('express');
const path = require('path');
const pino = require('pino');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- LOGIQUE DE CRÉATION DU SOCKET (OPTIMISÉE KAMUI) ---
async function createSocket(phone, sessionsDir) {
    // Récupère la version la plus stable pour éviter le blocage
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionsDir);
    const silentLogger = pino({ level: "silent" });

    const socket = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        logger: silentLogger,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        // CORRECTIFS ANTI-CHARGEMENT INFINI
        connectTimeoutMs: 60000, // Attendre 60s la réponse de WhatsApp
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        getMessage: async (key) => {
            return { conversation: "" }; // Valide le chiffrement
        },
    });

    return { socket, saveCreds };
}

// --- ROUTE DE JUMELAGE ---
app.get('/pairing', async (req, res) => {
    let num = req.query.code;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    const phone = num.replace(/[^0-9]/g, '');
    const sessionsDir = path.join(__dirname, 'sessions', `session_${phone}`);
    
    try {
        // Nettoyage pour forcer une nouvelle tentative propre
        if (await fs.pathExists(sessionsDir)) {
            await fs.remove(sessionsDir);
        }
        await fs.ensureDir(sessionsDir);

        const { socket, saveCreds } = await createSocket(phone, sessionsDir);

        if (!socket.authState.creds.registered) {
            await delay(3000); // Stabilisation
            const pairingCode = await socket.requestPairingCode(phone);
            
            if (!res.headersSent) {
                res.json({ code: pairingCode });
            }
        }

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`✅ OBITO-MD lié à ${phone}`);
                await socket.sendMessage(socket.user.id, { 
                    text: "🌀 *OBITO-MD : SYSTÈME ÉVEILLÉ*\n\nLa connexion est stabilisée. Votre bot est prêt." 
                });
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                console.log("❌ Connexion fermée. Reconnexion :", shouldReconnect);
            }
        });

        socket.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (body.toLowerCase() === ".menu") {
                await socket.sendMessage(msg.key.remoteJid, { text: "🌀 *OBITO-MD* est en ligne !" });
            }
        });

    } catch (err) {
        console.error("Erreur:", err);
        if (!res.headersSent) res.status(500).json({ error: "Échec" });
    }
});

app.listen(PORT, () => console.log(`🌀 Obito-MD actif sur port ${PORT}`));
