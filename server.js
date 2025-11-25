import { PeerServer } from 'peer';

const port = process.env.PORT ? parseInt(process.env.PORT) : 9000;

console.log(`Iniciando servidor PeerJS na porta ${port}...`);

const peerServer = PeerServer({
  port: port,
  path: '/myapp', // Caminho importante para a conexão
  proxied: true,  // Essencial para funcionar atrás do HTTPS do Render
  allow_discovery: true,
  corsOptions: {
      origin: '*',
  }
});

console.log('Servidor rodando!');
