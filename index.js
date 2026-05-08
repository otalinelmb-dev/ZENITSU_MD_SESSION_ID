const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore, 
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

// --- GÉNÉRATION DU CODE DE JUMELAGE ---
app.get('/pairing', async (req, res) => {
    let num = req.query.code;
    if (!num) return res.status(400).json({ error: "Numéro requis" });

    // Nettoyage des caractères spéciaux du numéro
    const phoneNumber = num.replace(/[^0-9]/g, '');
    const authFolder = path.join(__dirname, 'sessions', `session_${phoneNumber}`);
    
    try {
        // Supprime l'ancienne session pour forcer un nouveau code propre
        if (fs.existsSync(authFolder)) {
            await fs.remove(authFolder);
        }
        await fs.ensureDir(authFolder);

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"], // Navigateur stable
            printQRInTerminal: false,
            markOnlineOnConnect: true
        });

        // Demande du code de jumelage
        if (!socket.authState.creds.registered) {
            await delay(3000); // Temps de stabilisation
            const pairingCode = await socket.requestPairingCode(phoneNumber);
            
            // On envoie le code au site
            if (!res.headersSent) {
                res.json({ code: pairingCode });
            }
        }

        // --- GESTION DE LA CONNEXION ---
        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`✅ OBITO-MD lié avec succès à : ${phoneNumber}`);
                
                // Envoi d'un message de confirmation sur ton WhatsApp
                await socket.sendMessage(socket.user.id, { 
                    text: "🌀 *OBITO-MD : SYSTÈME ACTIVÉ*\n\nVotre bot est maintenant connecté au serveur Replit.\n\nTapez *.menu* pour voir les commandes." 
                });
            }

            if (connection === 'close') {
                console.log("❌ Connexion interrompue.");
                // Optionnel : tu peux ajouter une logique de reconnexion ici
            }
        });

        // --- GESTION DES MESSAGES (TEST) ---
        socket.ev.on('messages.upsert', async (chat) => {
            const msg = chat.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            
            if (text.toLowerCase() === ".menu") {
                await socket.sendMessage(msg.key.remoteJid, { 
                    text: "🌀 *MENU OBITO-MD* 🌀\n\nSystème opérationnel." 
                });
            }
        });

    } catch (err) {
        console.error("Erreur serveur:", err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Erreur lors de la génération du code" });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🌀 Serveur Obito-MD actif sur http://localhost:${PORT}`);
});
