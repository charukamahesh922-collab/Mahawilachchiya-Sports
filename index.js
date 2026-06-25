const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { createClient } = require('@libsql/client');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const db = createClient({
    url: 'libsql://mds-sports-charuka55.aws-ap-northeast-1.turso.io',
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODIzMDkxOTksImlkIjoiMDE5ZWY5ZTQtYWUwMS03ZTA1LWE5ZjctNTBjMTMwZWVmNjdlIiwicmlkIjoiYmRmMzFmMmEtY2U5NC00NjIyLTllNTItNTM1NDI5MWE2ZjIwIn0.P6eCYz0YwJzXJcFwu3TqgfDpubNuG3jO2gtyrDqcPorPuCAvvcyxIRnfZ0SjSwFJygKEiMr-iUwyTXlgV5GvCw'
});

let botSocket = null;
let isConnected = false;
let myNumber = null;
const logger = pino({ level: 'info' });

// Debug log function
function debugLog(message) {
    const timestamp = new Date().toISOString();
    const log = '[' + timestamp + '] ' + message + '\n';
    console.log(message);
    try {
        fs.appendFileSync('debug-send.log', log);
    } catch(e) {}
}

async function getPendingOTPs() {
    try {
        const result = await db.execute(
            "SELECT * FROM schools WHERE is_verified = 0 AND otp_code IS NOT NULL AND otp_expires_at > datetime('now') AND status = 'pending' AND otp_sent_at IS NULL LIMIT 5"
        );
        return result.rows;
    } catch(err) { return []; }
}

async function markAsSent(id) {
    try { await db.execute({ sql: "UPDATE schools SET otp_sent_at = datetime('now') WHERE id = ?", args: [id] }); } catch(err) {}
}

async function sendOTP(sock, school_name, whatsapp_number, otp_code) {
    debugLog('═══════════════════════════════');
    debugLog('📤 SEND ATTEMPT');
    debugLog('📱 Bot: ' + (sock?.user?.id?.split(':')[0] || 'unknown'));
    debugLog('📱 To: ' + whatsapp_number);
    debugLog('🏫 School: ' + school_name);
    debugLog('🔑 OTP: ' + otp_code);
    
    if (!sock || !sock.user) {
        debugLog('❌ FAIL: No socket');
        debugLog('═══════════════════════════════');
        return false;
    }
    
    const message = '🏆 *MDS 2025*\n\n🏫 *' + school_name + '*\n🔑 OTP: *' + otp_code + '*\n⏰ 10 mins';
    
    const formats = [
        whatsapp_number + '@s.whatsapp.net',
        whatsapp_number.replace(/^94/, '') + '@s.whatsapp.net'
    ];
    
    for (let i = 0; i < formats.length; i++) {
        const jid = formats[i];
        debugLog('📤 Try ' + (i+1) + ': ' + jid);
        
        try {
            const result = await sock.sendMessage(jid, { text: message });
            debugLog('✅ RESULT: ' + JSON.stringify(result));
            debugLog('✅ SENT! ID: ' + (result?.key?.id || 'NONE'));
            debugLog('═══════════════════════════════');
            return true;
        } catch (err) {
            debugLog('❌ Error: ' + err.message);
        }
    }
    
    debugLog('❌ ALL FAILED');
    debugLog('═══════════════════════════════');
    return false;
}

async function checkAndSend() {
    if (!isConnected || !botSocket || !botSocket.user) return;
    
    const pending = await getPendingOTPs();
    
    if (pending.length === 0) {
        debugLog('✅ No pending');
        return;
    }
    
    debugLog('📨 Found ' + pending.length + ' pending');
    
    for (const req of pending) {
        await markAsSent(req.id);
        const sent = await sendOTP(botSocket, req.school_name, req.whatsapp_number, req.otp_code);
        if (!sent) {
            await db.execute({ sql: "UPDATE schools SET otp_sent_at = NULL WHERE id = ?", args: [req.id] });
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

async function startBot() {
    debugLog('🤖 Bot Starting...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        printQRInTerminal: true,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: false,
        syncFullHistory: false
    });
    
    botSocket = sock;
    
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log('\n📱 SCAN QR CODE:');
            qrcode.generate(qr, { small: true });
            console.log('WhatsApp > Settings > Linked Devices > Scan\n');
        }
        
        if (connection === 'open') {
            isConnected = true;
            myNumber = sock.user?.id?.split(':')[0] || 'unknown';
            debugLog('✅ Connected! Number: ' + myNumber);
            checkAndSend();
            setInterval(checkAndSend, 10000);
        }
        
        if (connection === 'close') {
            isConnected = false;
            debugLog('❌ Disconnected');
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
}

console.log('🚀 MDS OTP Bot v5.0\n');
startBot();
