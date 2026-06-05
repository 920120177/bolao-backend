const express = require('express');
const cors    = require('cors');
const https   = require('https');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const EFI_CLIENT_ID     = process.env.EFI_CLIENT_ID;
const EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET;
const EFI_PIX_KEY       = process.env.EFI_PIX_KEY;
const EFI_URL           = 'https://pix.api.efipay.com.br';

// Obter token de acesso EfiPay
async function getEfiToken() {
  const credentials = Buffer.from(EFI_CLIENT_ID + ':' + EFI_CLIENT_SECRET).toString('base64');
  const resp = await fetch(EFI_URL + '/oauth/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' })
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Erro ao obter token EfiPay: ' + JSON.stringify(data));
  return data.access_token;
}

// Criar cobrança PIX
app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, email, bilheteId, valor } = req.body;
    if (!nome || !email || !bilheteId || !valor) return res.status(400).json({ erro: 'Dados incompletos.' });

    const token = await getEfiToken();

    // Criar cobrança imediata
    const cobResp = await fetch(EFI_URL + '/v2/cob', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendario: { expiracao: 1800 },
        devedor: { nome, cpf: '00000000000' },
        valor: { original: Number(valor).toFixed(2) },
        chave: EFI_PIX_KEY,
        solicitacaoPagador: 'Arena do Palpite - Bilhete ' + bilheteId,
        infoAdicionais: [{ nome: 'Bilhete', valor: bilheteId }]
      })
    });

    const cob = await cobResp.json();
    if (!cob.txid) throw new Error('Erro ao criar cobrança: ' + JSON.stringify(cob));

    // Gerar QR Code
    const qrResp = await fetch(EFI_URL + '/v2/loc/' + cob.loc.id + '/qrcode', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const qr = await qrResp.json();

    return res.json({
      pagamentoId:  cob.txid,
      status:       cob.status,
      qrCodeBase64: qr.imagemQrcode,
      copiaCola:    qr.qrcode,
    });
  } catch (err) {
    console.error('Erro PIX EfiPay:', err.message);
    return res.status(500).json({ erro: err.message });
  }
});

// Consultar status
app.get('/status/:txid', async (req, res) => {
  try {
    const token = await getEfiToken();
    const resp = await fetch(EFI_URL + '/v2/cob/' + req.params.txid, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await resp.json();
    return res.json({
      pagamentoId: data.txid,
      status:      data.status === 'CONCLUIDA' ? 'approved' : 'pending',
      bilheteId:   data.infoAdicionais?.[0]?.valor
    });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Arena do Palpite - EfiPay OK ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor na porta ' + PORT));
