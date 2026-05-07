const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const express = require('express');
const path = require('path');
const pino = require('pino');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT : Pour que Render trouve ton HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/pairing', async (req, res) => {
    let num = req.query.code;
    if (!num) return res.status(400).json({ error: "Numéro manquant" });

    console.log("Demande de code pour : " + num);

    const authFolder = `./temp_auth_${Date.now()}`;
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const socket = makeWASocket({
            auth: state,
            logger: pino({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        if (!socket.authState.creds.registered) {
            await delay(2000);
            const pairingCode = await socket.requestPairingCode(num.replace(/[^0-9]/g, ''));
            console.log("Code généré : " + pairingCode);
            res.json({ code: pairingCode });
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
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Activation (Le reste de ton code activation...)
app.get('/activate', (req, res) => {
    res.send("Activation reçue !");
});

app.listen(PORT, () => console.log(`ZENITSU_MD est en ligne sur le port ${PORT}`));
