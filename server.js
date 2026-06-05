const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const https   = require('https');
const path    = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const EFI_CLIENT_ID     = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_PIX_KEY       = process.env.EFI_PIX_KEY;
const EFI_CERT_BASE64   = process.env.EFI_CERT;
const EFI_URL           = 'https://pix.api.efipay.com.br';

// Salvar certificado em arquivo temporário
const certPath = '/tmp/efi_cert.p12';
if (EFI_CERT_BASE64) {
  fs.writeFileSync(certPath, Buffer.from(EFI_CERT_BASE64, 'base64'));
}

// Agente HTTPS com certificado
function getAgent() {
  return new https.Agent({
    pfx: fs.readFileSync(certPath),
    passphrase: ''
  });
}

async function getEfiToken() {
  const credentials = Buffer.from(EFI_CLIENT_ID + ':' + EFI_CLIENT_SECRET).toString('base64');
  const resp = await fetch(EFI_URL + '/oauth/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
    agent: getAgent()
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function efiRequest(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    agent: getAgent()
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(EFI_URL + path, opts);
  return resp.json();
}

app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, email, bilheteId, valor } = req.body;
    if (!nome || !email || !bilheteId || !valor) return res.status(400).json({ erro: 'Dados incompletos.' });
    const token = await getEfiToken();
    const cob = await efiRequest('POST', '/v2/cob', {
      calendario: { expiracao: 1800 },
      devedor: { nome, cpf: '00000000000' },
      valor: { original: Number(valor).toFixed(2) },
      chave: EFI_PIX_KEY,
      solicitacaoPagador: 'Arena do Palpite - Bilhete ' + bilheteId,
      infoAdicionais: [{ nome: 'Bilhete', valor: bilheteId }]
    }, token);
    if (!cob.txid) throw new Error('Erro cobrança: ' + JSON.stringify(cob));
    const qr = await efiRequest('GET', '/v2/loc/' + cob.loc.id + '/qrcode', null, token);
    return res.json({
      pagamentoId:  cob.txid,
      status:       cob.status,
      qrCodeBase64: qr.imagemQrcode,
      copiaCola:    qr.qrcode,
    });
  } catch (err) {
    console.error('Erro PIX:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/status/:txid', async (req, res) => {
  try {
    const token = await getEfiToken();
    const data = await efiRequest('GET', '/v2/cob/' + req.params.txid, null, token);
    return res.json({
      pagamentoId: data.txid,
      status: data.status === 'CONCLUIDA' ? 'approved' : 'pending',
      bilheteId: data.infoAdicionais?.[0]?.valor
    });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Arena do Palpite - EfiPay OK ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor na porta ' + PORT));
