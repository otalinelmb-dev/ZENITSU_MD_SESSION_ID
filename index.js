const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const express = require('express');
const path = require('path');
const pino = require('pino');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ÉTAPE 1 : GÉNÉRATION DU CODE DE JUMELAGE ---
app.get('/pairing', async (req, res) => {
    let num = req.query.code;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    const authFolder = path.join(__dirname, 'sessions', 'temp_' + num.replace(/[^0-9]/g, ''));
    
    try {
        await fs.ensureDir(authFolder);
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            printQRInTerminal: false
        });

        if (!socket.authState.creds.registered) {
            await delay(2000);
            const pairingCode = await socket.requestPairingCode(num.replace(/[^0-9]/g, ''));
            res.json({ code: pairingCode });
        }

        socket.ev.on('creds.update', saveCreds);
        
        socket.ev.on('connection.update', async (s) => {
            if (s.connection === 'open') {
                await delay(5000);
                const credsFile = path.join(authFolder, 'creds.json');
                if (fs.existsSync(credsFile)) {
                    const credsData = fs.readFileSync(credsFile);
                    const sessionID = Buffer.from(credsData).toString('base64');
                    
                    await socket.sendMessage(socket.user.id, { 
                        text: `⚡ *ZENITSU_MD SESSION* ⚡\n\nSESSION_ID :\nZENITSU_MD_${sessionID}\n\nCopiez cette clé et collez-la sur le site pour activer votre bot.` 
                    });
                    setTimeout(() => fs.remove(authFolder).catch(e => {}), 30000);
                }
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// --- ÉTAPE 2 : ACTIVATION DU BOT ---
app.get('/activate', async (req, res) => {
    const session = req.query.session;
    if (!session || !session.startsWith("ZENITSU_MD_")) return res.status(400).send("Session invalide.");
    startZenitsuBot(session);
    res.send("Activation lancée ! Vérifiez WhatsApp.");
});

async function startZenitsuBot(sessionStr) {
    const sessionData = Buffer.from(sessionStr.replace("ZENITSU_MD_", ""), 'base64').toString();
    const liveFolder = path.join(__dirname, 'sessions', 'active_bot');
    await fs.ensureDir(liveFolder);
    await fs.writeJson(path.join(liveFolder, 'creds.json'), JSON.parse(sessionData));

    const { state, saveCreds } = await useMultiFileAuthState(liveFolder);
    const client = makeWASocket({
        auth: state,
        logger: pino({ level: "fatal" }),
        browser: Browsers.macOS("Desktop")
    });

    client.ev.on('creds.update', saveCreds);
    client.ev.on('connection.update', (u) => {
        if (u.connection === 'open') {
            client.sendMessage(client.user.id, { text: "⚡ *ZENITSU_MD ACTIVÉ !*\nTapez *.menu*" });
        }
    });

    client.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (body.toLowerCase() === ".menu") {
            await client.sendMessage(from, { text: "⚡ *ZENITSU_MD MENU* ⚡\n\n.ping\n.owner\n.alive" });
        }
    });
}

app.listen(PORT, () => console.log(`Zenitsu-MD prêt sur le port ${PORT}`));
