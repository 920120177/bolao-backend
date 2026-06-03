const express    = require('express');
const cors       = require('cors');
const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(client);

app.post('/criar-pix', async (req, res) => {
  try {
    const { nome, email, bilheteId, valor } = req.body;
    if (!nome || !email || !bilheteId || !valor) {
      return res.status(400).json({ erro: 'Dados incompletos.' });
    }
    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: Number(valor),
        description:        `BolaoGol - Bilhete ${bilheteId}`,
        payment_method_id:  'pix',
        payer: {
          email,
          first_name: nome.split(' ')[0],
          last_name:  nome.split(' ').slice(1).join(' ') || 'Participante',
          identification: { type: 'CPF', number: '00000000000' },
        },
        external_reference: bilheteId,
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    });
    const pix = pagamento.point_of_interaction?.transaction_data;
    return res.json({
      pagamentoId:  pagamento.id,
      status:       pagamento.status,
      qrCode:       pix?.qr_code,
      qrCodeBase64: pix?.qr_code_base64,
      copiaCola:    pix?.qr_code,
      valor:        pagamento.transaction_amount,
    });
  } catch (err) {
    console.error('Erro PIX:', err);
    return res.status(500).json({ erro: 'Erro ao criar PIX.', detalhe: err.message });
  }
});

app.post('/criar-cartao', async (req, res) => {
  try {
    const { nome, email, cpf, bilheteId, valor, token, parcelas } = req.body;
    if (!nome || !email || !bilheteId || !valor || !token) {
      return res.status(400).json({ erro: 'Dados incompletos.' });
    }
    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: Number(valor),
        token,
        description:        `BolaoGol - Bilhete ${bilheteId}`,
        installments:       Number(parcelas) || 1,
        payer: {
          email,
          first_name: nome.split(' ')[0],
          last_name:  nome.split(' ').slice(1).join(' ') || 'Participante',
          identification: { type: 'CPF', number: (cpf||'').replace(/\D/g,'') },
        },
        external_reference: bilheteId,
      },
    });
    return res.json({
      pagamentoId: pagamento.id,
      status:      pagamento.status,
      detalhe:     pagamento.status_detail,
    });
  } catch (err) {
    console.error('Erro cartão:', err);
    return res.status(500).json({ erro: 'Erro ao processar cartão.', detalhe: err.message });
  }
});

app.get('/status/:pagamentoId', async (req, res) => {
  try {
    const pagamento = await paymentClient.get({ id: req.params.pagamentoId });
    return res.json({
      pagamentoId: pagamento.id,
      status:      pagamento.status,
      detalhe:     pagamento.status_detail,
      bilheteId:   pagamento.external_reference,
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao consultar.', detalhe: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'BolaoGol backend rodando OK' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
