const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_URL   = 'https://api.mercadopago.com';

async function mpPost(path, body) {
  const r = await fetch(MP_URL + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + MP_TOKEN, 'Content-Type': 'application/json', 'X-Idempotency-Key': Date.now().toString() },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function mpGet(path) {
  const r = await fetch(MP_URL + path, {
    headers: { 'Authorization': 'Bearer ' + MP_TOKEN }
  });
  return r.json();
}

app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, email, bilheteId, valor } = req.body;
    if (!nome || !email || !bilheteId || !valor) return res.status(400).json({ erro: 'Dados incompletos.' });
    const data = await mpPost('/v1/payments', {
      transaction_amount: Number(valor),
      description: 'Arena do Palpite - Bilhete ' + bilheteId,
      payment_method_id: 'pix',
      payer: { email, first_name: nome.split(' ')[0], last_name: nome.split(' ').slice(1).join(' ') || 'Participante' },
      external_reference: bilheteId,
      date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    });
    if (data.error) return res.status(400).json({ erro: data.message || data.error });
    const pix = data.point_of_interaction?.transaction_data;
    return res.json({
      pagamentoId:  data.id,
      status:       data.status,
      qrCodeBase64: pix?.qr_code_base64,
      copiaCola:    pix?.qr_code,
    });
  } catch (err) {
    console.error('Erro PIX:', err);
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/status/:id', async (req, res) => {
  try {
    const data = await mpGet('/v1/payments/' + req.params.id);
    return res.json({ pagamentoId: data.id, status: data.status, bilheteId: data.external_reference });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.post('/criar-cartao', async (req, res) => {
  try {
    const { nome, email, cpf, bilheteId, valor, token, parcelas } = req.body;
    if (!nome || !email || !bilheteId || !valor || !token) return res.status(400).json({ erro: 'Dados incompletos.' });
    const data = await mpPost('/v1/payments', {
      transaction_amount: Number(valor),
      token,
      description: 'Arena do Palpite - Bilhete ' + bilheteId,
      installments: Number(parcelas) || 1,
      payer: { email, first_name: nome.split(' ')[0], last_name: nome.split(' ').slice(1).join(' ') || 'Participante', identification: { type: 'CPF', number: (cpf || '').replace(/\D/g, '') } },
      external_reference: bilheteId
    });
    if (data.error) return res.status(400).json({ erro: data.message || data.error });
    return res.json({ pagamentoId: data.id, status: data.status, detalhe: data.status_detail });
  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'Arena do Palpite backend OK ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor na porta ' + PORT));
