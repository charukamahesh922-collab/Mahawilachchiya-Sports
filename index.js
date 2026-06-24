const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let botSocket = null;
const PORT = process.env.PORT || 3000;

const logger = pino({ 
    level: 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname'
        }
    }
});

// Serve QR code image
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr-code.txt');
    if (fs.existsSync(qrPath)) {
        res.send('<pre>' + fs.readFileSync(qrPath, 'utf8') + '</pre>');
    } else {
        res.send('QR not yet generated. Bot may already be connected.');
    }
});

// Webhook endpoint
app.post('/webhook/send-otp', async (req, res) => {
    const { school_name, whatsapp_number, otp_code } = req.body;
    
    console.log('========================================');
    console.log('📨 NEW OTP REQUEST');
    console.log('School:', school_name);
    console.log('WhatsApp:', whatsapp_number);
    console.log('OTP:', otp_code);
    console.log('========================================');
    
    if (!botSocket) {
        console.log('❌ Bot not connected to WhatsApp');
        return res.json({ success: false, message: 'Bot not ready. Please try again.' });
    }
    
    try {
        const jid = whatsapp_number + '@s.whatsapp.net';
        
        const message = 
            '🏆 *Mahawilachchiya Divisional Sports 2025*\n\n' +
            '📋 *School Registration - OTP Verification*\n\n' +
            '┌──────────────────────┐\n' +
            '│  🏫 School: *' + school_name + '*\n' +
            '│  🔑 OTP Code: *' + otp_code + '*\n' +
            '│  ⏰ Expires in: 10 minutes\n' +
            '└──────────────────────┘\n\n' +
            '📌 *Instructions:*\n' +
            '1️⃣ Go to the registration page\n' +
            '2️⃣ Enter this 6-digit OTP\n' +
            '3️⃣ Complete your verification\n\n' +
            '🔒 Do NOT share this OTP!\n' +
            '📞 Need help? Contact admin.\n\n' +
            '_Mahawilachchiya Divisional Sports 2025_ 🇱🇰';
        
        await botSocket.sendMessage(jid, { text: message });
        
        console.log('✅ OTP SENT SUCCESSFULLY!');
        console.log('================================\n');
        
        res.json({ 
            success: true, 
            message: 'OTP sent successfully to ' + whatsapp_number 
        });
        
    } catch (err) {
        console.error('❌ Send error:', err.message);
        res.json({ success: false, message: 'Failed to send: ' + err.message });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        bot: 'Mahawilachchiya Sports OTP Bot',
        whatsapp: botSocket ? 'connected' : 'disconnected',
        uptime: Math.floor(process.uptime()) + ' seconds',
        timestamp: new Date().toISOString()
    });
});

// Status page
app.get('/status', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>MDS OTP Bot Status</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: Arial; text-align: center; padding: 40px; background: #1a1a1a; color: white; }
                .card { background: #2a2a2a; padding: 30px; border-radius: 12px; max-width: 400px; margin: 0 auto; }
                .online { color: #2ecc71; font-size: 48px; }
                h1 { font-size: 24px; }
                .info { color: #c4a47a; }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="online">✅</div>
                <h1>MDS OTP Bot</h1>
                <p>Status: <span class="info">Online</span></p>
                <p>WhatsApp: <span class="info">${botSocket ? 'Connected' : 'Connecting...'}</span></p>
                <p>Uptime: <span class="info">${Math.floor(process.uptime())}s</span></p>
                <p>Webhook: <span class="info">/webhook/send-otp</span></p>
            </div>
        </body>
        </html>
    `);
});

// WhatsApp Bot
async function startBot() {
    console.log('\n🤖 Starting WhatsApp Bot...\n');
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();
        
        console.log('📱 WhatsApp Version:', version.join('.'));
        
        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: true,
            browser: Browsers.ubuntu('Chrome'),
            logger,
            markOnlineOnConnect: true,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });
        
        botSocket = sock;
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 ===== SCAN THIS QR CODE =====\n');
                qrcode.generate(qr, { small: true });
                
                // Save QR to file
                fs.writeFileSync('qr-code.txt', qr);
                console.log('QR also saved to qr-code.txt\n');
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(startBot, 5000);
                }
            }
            
            if (connection === 'open') {
                console.log('\n✅ WhatsApp Connected Successfully!');
                console.log('📱 Bot is ready to send OTPs');
                console.log('📡 Webhook endpoint: /webhook/send-otp\n');
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        console.error('❌ Bot error:', err.message);
        setTimeout(startBot, 10000);
    }
}

// Start everything
console.log('🚀 Mahawilachchiya Divisional Sports OTP Bot');
console.log('═'.repeat(50));

startBot();

app.listen(PORT, () => {
    console.log('\n🌐 Server running on port ' + PORT);
    console.log('📡 Health check: http://localhost:' + PORT + '/');
    console.log('📡 Status page: http://localhost:' + PORT + '/status');
    console.log('📡 QR Code: http://localhost:' + PORT + '/qr');
    console.log('📡 Webhook: http://localhost:' + PORT + '/webhook/send-otp');
    console.log('═'.repeat(50) + '\n');
});
