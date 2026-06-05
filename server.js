const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const https   = require('https');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const EFI_CLIENT_ID     = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_PIX_KEY       = process.env.EFI_PIX_KEY;
const EFI_CERT_BASE64   = process.env.EFI_CERT;
const EFI_URL           = 'pix.api.efipay.com.br';

function getAgent() {
  const pfx = Buffer.from(EFI_CERT_BASE64, 'base64');
  return new https.Agent({ pfx, passphrase: '' });
}

function efiReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {
        'Authorization': 'Basic ' + Buffer.from(EFI_CLIENT_ID + ':' + EFI_CLIENT_SECRET).toString('base64')
      })
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: EFI_URL,
      path,
      method,
      headers,
      agent: getAgent()
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getToken() {
  const data = await efiReq('POST', '/oauth/token', { grant_type: 'client_credentials' }, null);
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, email, bilheteId, valor } = req.body;
    if (!nome || !email || !bilheteId || !valor) return res.status(400).json({ erro: 'Dados incompletos.' });
    const token = await getToken();
    const cob = await efiReq('POST', '/v2/cob', {
      calendario: { expiracao: 1800 },
      devedor: { nome, cpf: req.body.cpf ? req.body.cpf.replace(/\D/g,'') : undefined },
      valor: { original: Number(valor).toFixed(2) },
      chave: EFI_PIX_KEY,
      solicitacaoPagador: 'Arena do Palpite - Bilhete ' + bilheteId,
      infoAdicionais: [{ nome: 'Bilhete', valor: bilheteId }]
    }, token);
    if (!cob.txid) throw new Error('Erro cob: ' + JSON.stringify(cob));
    const qr = await efiReq('GET', '/v2/loc/' + cob.loc.id + '/qrcode', null, token);
console.log('QR Response keys:', Object.keys(qr));
return res.json({
  pagamentoId:  cob.txid,
  status:       cob.status,
  qrCodeBase64: qr.imagemQrcode || qr.qr_code_base64 || qr.imagem || qr.imagemQRcode || null,
  copiaCola:    qr.qrcode || qr.qr_code || qr.copia_e_cola || null,
});
  } catch (err) {
    console.error('Erro PIX:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/status/:txid', async (req, res) => {
  try {
    const token = await getToken();
    const data = await efiReq('GET', '/v2/cob/' + req.params.txid, null, token);
    return res.json({
      pagamentoId: data.txid,
      status: data.status === 'CONCLUIDA' ? 'approved' : 'pending',
      bilheteId: data.infoAdicionais?.[0]?.valor
    });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Arena do Palpite - EfiPay OK' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor na porta ' + PORT));
