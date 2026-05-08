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

// --- LOGIQUE DE CRÉATION DU SOCKET (CORRIGÉE) ---
async function createSocket(phone, sessionsDir) {
    // CORRECTIF 1 : Récupérer la version la plus récente de WhatsApp pour éviter le rejet
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
        // CORRECTIF 2 : getMessage est obligatoire pour compléter le handshake de chiffrement
        getMessage: async (key) => {
            return { conversation: "" }; // Suffisant pour valider la connexion
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
        // Nettoyage radical de l'ancienne session
        if (await fs.pathExists(sessionsDir)) {
            await fs.remove(sessionsDir);
        }
        await fs.ensureDir(sessionsDir);

        const { socket, saveCreds } = await createSocket(phone, sessionsDir);

        if (!socket.authState.creds.registered) {
            // Attendre la stabilisation avant de demander le code
            await delay(3000);
            const pairingCode = await socket.requestPairingCode(phone);
            
            if (!res.headersSent) {
                res.json({ code: pairingCode });
            }
        }

        // --- GESTION DES ÉVÉNEMENTS ---
        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                console.log(`✅ OBITO-MD : Connexion réussie pour ${phone}`);
                await socket.sendMessage(socket.user.id, { 
                    text: "🌀 *OBITO-MD : ACTIVATION RÉUSSIE*\n\nLe bot est maintenant lié avec succès via le correctif de chiffrement." 
                });
            }
            
            if (connection === 'close') {
                console.log("❌ Connexion fermée.");
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
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: "Erreur d'invocation" });
    }
});

app.listen(PORT, () => console.log(`🌀 Obito-MD prêt sur le port ${PORT}`));
