import React, { useState, useRef, useEffect } from 'react';
import Whiteboard from './components/Whiteboard';
import Toolbar from './components/Toolbar';
import type { Tool, CanvasElement, ImageElement, SyncMessage } from './types';
import * as pdfjsLib from 'pdfjs-dist';
import { CameraIcon, CameraOffIcon, MicIcon, MicOffIcon, ExitIcon, ClipboardIcon } from './components/icons/index';
import { Peer } from 'peerjs';

// Configura o worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type UserRole = 'host' | 'guest' | null;

const App: React.FC = () => {
  // --- App State ---
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>('#000000');
  const [lineWidth, setLineWidth] = useState<number>(4);
  
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [undoStack, setUndoStack] = useState<CanvasElement[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);

  // --- Network/Lobby State ---
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerIdInput, setRemotePeerIdInput] = useState<string>('');
  const [role, setRole] = useState<UserRole>(null);
  const peerRef = useRef<any | null>(null);
  const connRef = useRef<any | null>(null);
  const callRef = useRef<any | null>(null);

  // --- Video Call State ---
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  // Refs para garantir acesso síncrono dentro dos callbacks do PeerJS
  const localStreamRef = useRef<MediaStream | null>(null);
  const [mediaStreamState, setMediaStreamState] = useState<MediaStream | null>(null); // Apenas para re-renderizar UI
  
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const canUndo = elements.length > 0;
  const canRedo = undoStack.length > 0;

  // --- Initialization & Media ---

  useEffect(() => {
    // Check for room in URL
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        setRole('guest');
        setRemotePeerIdInput(room);
    }

    const initCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            handleStreamSuccess(stream);
        } catch (err: any) {
            console.warn("Falha ao obter Audio+Video padrão:", err);
            try {
                const streamVideoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                handleStreamSuccess(streamVideoOnly);
                setIsMicOn(false);
                alert("Aviso: Microfone indisponível. Apenas vídeo ativado.");
            } catch (errVideo: any) {
                 console.error("Falha crítica na câmera:", errVideo);
                 alert("Não foi possível acessar a câmera. Verifique permissões.");
            }
        }
    };

    const handleStreamSuccess = (stream: MediaStream) => {
        // Salva na Ref para acesso imediato no PeerJS
        localStreamRef.current = stream;
        // Salva no State para atualizar a UI
        setMediaStreamState(stream);
        
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
        }
    };

    initCamera();

    return () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // Controle de Mute/Video Off
  useEffect(() => {
    if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => track.enabled = isMicOn);
        localStreamRef.current.getVideoTracks().forEach(track => track.enabled = isCamOn);
    }
  }, [isMicOn, isCamOn, mediaStreamState]);

  // Garante que o vídeo remoto toque assim que o stream chegar
  useEffect(() => {
      if (remoteVideoRef.current && remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
      }
  }, [remoteStream]);


  // --- Networking Logic (PeerJS) ---

  const initializePeer = (type: 'host' | 'guest', autoConnectToId?: string) => {
      setConnectionState('connecting');
      setRole(type);

      // Gera ID local curto se for host, ou usa aleatório se guest
      const customId = type === 'host' ? `aula-${Math.floor(Math.random() * 10000)}` : undefined;

      const peer = new (Peer as any)(customId, {
          config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
              ]
          }
      });
      peerRef.current = peer;

      peer.on('open', (id: string) => {
          setMyPeerId(id);
          
          if (type === 'host') {
              setConnectionState('connecting');
          } else if (autoConnectToId) {
              connectToHost(autoConnectToId);
          }
      });

      peer.on('connection', (conn: any) => {
          connRef.current = conn;
          setupDataConnection(conn);
          setConnectionState('connected');
          // Envia estado atual para o aluno que entrou
          setTimeout(() => sendSyncMessage({ type: 'SYNC_FULL_STATE', payload: elements }), 500);
          
          // Se sou HOST e recebi conexão, ligo para o aluno para iniciar vídeo
          if (type === 'host' && localStreamRef.current) {
             // Pequeno delay para garantir estabilidade
             setTimeout(() => {
                 callPeer(conn.peer);
             }, 1000);
          }
      });

      peer.on('call', (call: any) => {
          // Recebi uma chamada (Video)
          // IMPORTANTE: Usar localStreamRef.current para garantir que não é null
          const stream = localStreamRef.current;
          if (stream) {
              call.answer(stream); // Atende enviando meu vídeo
              callRef.current = call;
              call.on('stream', (remoteStream: any) => {
                  setRemoteStream(remoteStream);
              });
          } else {
              console.error("Recebi chamada mas não tenho stream local pronto.");
          }
      });

      peer.on('error', (err: any) => {
          console.error("Peer error:", err);
          if (err.type === 'peer-unavailable') {
              alert("Sala não encontrada. Verifique o código.");
          }
          setConnectionState('disconnected');
      });
  };

  const callPeer = (remotePeerId: string) => {
      const stream = localStreamRef.current;
      if (stream && peerRef.current) {
          const call = peerRef.current.call(remotePeerId, stream);
          callRef.current = call;
          call.on('stream', (remoteStream: any) => {
              setRemoteStream(remoteStream);
          });
      }
  };

  const connectToHost = (targetId?: string) => {
      const idToConnect = targetId || remotePeerIdInput;

      if (!idToConnect) {
          alert("Insira o Código da Sala.");
          return;
      }

      // Timeout para evitar loading infinito
      const connectionTimeout = setTimeout(() => {
          if (connectionState !== 'connected') {
              alert("Tempo limite excedido. Verifique se o Professor já iniciou a aula.");
              setConnectionState('disconnected');
              setRole(null);
          }
      }, 15000);

      const conn = peerRef.current.connect(idToConnect);
      connRef.current = conn;
      
      conn.on('open', () => {
          clearTimeout(connectionTimeout);
          setConnectionState('connected');
          setupDataConnection(conn);
          // Assim que conecto os dados, tento ligar o vídeo também
          callPeer(idToConnect);
      });
      
      conn.on('error', (err: any) => {
          clearTimeout(connectionTimeout);
          console.error("Connection Error", err);
      });
  };

  const setupDataConnection = (conn: any) => {
      conn.on('data', (data: any) => {
          handleRemoteData(data as SyncMessage);
      });
      conn.on('close', () => {
          alert("Desconectado.");
          setConnectionState('disconnected');
          setRemoteStream(null);
          setRole(null);
          window.location.reload();
      });
  };

  const sendSyncMessage = (msg: SyncMessage) => {
      if (connRef.current && connRef.current.open) {
          connRef.current.send(msg);
      }
  };

  const handleRemoteData = (msg: SyncMessage) => {
      switch (msg.type) {
          case 'SYNC_FULL_STATE':
              const rehydratedElements = (msg.payload as any[]).map(el => {
                  if (el.type === 'image' && el.src) {
                      const img = new Image();
                      img.src = el.src;
                      return { ...el, image: img };
                  }
                  return el;
              });
              setElements(rehydratedElements);
              break;
          case 'ADD_ELEMENT':
               setElements(prev => {
                   const newEl = msg.payload;
                   if (prev.find(e => e.id === newEl.id)) return prev;
                   if (newEl.type === 'image' && newEl.src) {
                       const img = new Image();
                       img.src = newEl.src;
                       return [...prev, { ...newEl, image: img }];
                   }
                   return [...prev, newEl];
               });
              break;
          case 'REMOVE_ELEMENT': 
              setElements(prev => prev.filter(el => el.id !== msg.payload));
              break;
          case 'CLEAR_BOARD':
              setElements([]);
              break;
          case 'UPDATE_ELEMENT':
               setElements(prev => prev.map(el => el.id === msg.payload.id ? { ...el, ...msg.payload } : el));
               break;
      }
  };

  const handleSetElements = (newElementsOrUpdater: React.SetStateAction<CanvasElement[]>) => {
      setElements(prev => {
          const next = typeof newElementsOrUpdater === 'function' 
            ? newElementsOrUpdater(prev) 
            : newElementsOrUpdater;
          
          if (next.length > prev.length) {
              const newEl = next[next.length - 1];
              let payload = { ...newEl };
              if (newEl.type === 'image') {
                   if (newEl.image && newEl.image.src.startsWith('data:')) {
                       (payload as any).src = newEl.image.src;
                       (payload as any).image = undefined; 
                   }
              }
              sendSyncMessage({ type: 'ADD_ELEMENT', payload });
          } 
          else if (next.length < prev.length) {
              const remainingIds = new Set(next.map(e => e.id));
              const removed = prev.find(e => !remainingIds.has(e.id));
              if (removed) {
                  sendSyncMessage({ type: 'REMOVE_ELEMENT', payload: removed.id });
              }
          } else {
             // Mudança interna (ex: moveu algo) - simplificado para o exemplo
             // Idealmente checar diffs de posição aqui
          }
          
          return next;
      });
  };

  const handleClear = () => {
    if (window.confirm("Limpar a tela?")) {
        setElements([]);
        setUndoStack([]);
        sendSyncMessage({ type: 'CLEAR_BOARD' });
    }
  };

  const handleImportPdf = async (file: File) => {
    if (!file || file.type !== 'application/pdf') return;
    setIsLoadingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      const newElements: ImageElement[] = [];
      let currentY = 50; 

      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const imgData = canvas.toDataURL('image/png');
        const img = new Image();
        img.src = imgData;
        await new Promise((r) => img.onload = r);

        const el: ImageElement = {
            type: 'image',
            id: `pdf-${Date.now()}-${i}`,
            image: img,
            src: imgData,
            x: 100, y: currentY,
            width: viewport.width / 2, height: viewport.height / 2,
            locked: false
        };
        newElements.push(el);
        currentY += (viewport.height / 2) + 20;
      }
      
      setElements(prev => [...prev, ...newElements]);
      
      newElements.forEach(el => {
          sendSyncMessage({ type: 'ADD_ELEMENT', payload: { ...el, image: undefined } });
      });

      setTool('select'); 
    } catch (error) {
      console.error('Erro PDF:', error);
      alert('Erro ao processar PDF.');
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}?room=${myPeerId}`;
    navigator.clipboard.writeText(url).then(() => {
        alert("Link copiado! Envie para o aluno.");
    });
  };

  // --- Render: Lobby ---

  if (connectionState === 'disconnected' || (connectionState === 'connecting' && role === 'host' && !connRef.current)) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 font-sans text-slate-800">
              <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg transform -rotate-6">
                     <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" /></svg>
                  </div>
                  
                  <h1 className="text-2xl font-bold">Aplicativo do Profe. Gilson Antônio</h1>
                  
                  {!role ? (
                      <div className="grid grid-cols-2 gap-4">
                          <button 
                            onClick={() => initializePeer('host')}
                            className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                          >
                              <span className="text-3xl mb-2 group-hover:scale-110 transition-transform">👨‍🏫</span>
                              <span className="font-semibold text-slate-700">Iniciar Aula</span>
                              <span className="text-xs text-slate-500 mt-1">Sou o Professor</span>
                          </button>
                          <button 
                            onClick={() => initializePeer('guest')}
                            className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all group"
                          >
                              <span className="text-3xl mb-2 group-hover:scale-110 transition-transform">👨‍🎓</span>
                              <span className="font-semibold text-slate-700">Entrar na Aula</span>
                              <span className="text-xs text-slate-500 mt-1">Sou o Aluno</span>
                          </button>
                      </div>
                  ) : role === 'host' ? (
                      <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                          <p className="text-slate-600">Envie o link abaixo para o aluno:</p>
                          {myPeerId ? (
                              <button 
                                onClick={copyInviteLink}
                                className="w-full bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors group"
                              >
                                  <ClipboardIcon className="w-5 h-5 text-blue-600" />
                                  <span className="font-mono text-blue-800 font-semibold truncate">
                                    Copiar Link de Convite
                                  </span>
                              </button>
                          ) : (
                              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          )}
                          <p className="text-xs text-slate-400">Aguardando o aluno conectar...</p>
                          <button onClick={() => { setRole(null); peerRef.current?.destroy(); }} className="text-sm text-red-500 hover:underline">Cancelar</button>
                      </div>
                  ) : (
                      <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                          <p className="text-slate-600 text-sm">Insira o código ou confirme:</p>
                          
                          <input 
                            type="text" 
                            value={remotePeerIdInput}
                            onChange={(e) => setRemotePeerIdInput(e.target.value)}
                            placeholder="Cole o código aqui"
                            className="w-full p-3 border border-slate-300 rounded-lg text-center font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                          />

                          <button 
                            onClick={() => {
                                if (!peerRef.current) {
                                    initializePeer('guest', remotePeerIdInput);
                                } else {
                                    connectToHost();
                                }
                            }}
                            disabled={!remotePeerIdInput}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-green-200"
                          >
                              Entrar na Sala Agora
                          </button>
                          <button onClick={() => { setRole(null); peerRef.current?.destroy(); window.history.replaceState({}, '', '/'); }} className="text-sm text-red-500 hover:underline">Voltar</button>
                      </div>
                  )}
                  
                  {/* Local Video Preview in Lobby */}
                  <div className="mt-8 pt-8 border-t border-slate-100">
                      <p className="text-xs text-slate-400 mb-2">Sua Câmera</p>
                      <div className="w-32 h-24 bg-slate-900 rounded-lg mx-auto overflow-hidden shadow-inner relative">
                           <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // --- Render: Main App ---

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white">
      <h1 className="sr-only">Sala de Aula</h1>
      
      {isLoadingPdf && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="bg-white p-4 rounded-xl shadow-xl flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-slate-700 font-medium">Sincronizando PDF...</span>
            </div>
        </div>
      )}

      <Whiteboard
        tool={tool}
        color={color}
        lineWidth={lineWidth}
        elements={elements}
        setElements={handleSetElements}
        setUndoStack={setUndoStack}
      />
      
      {/* Sidebar de Videochamada */}
      <div className="absolute top-4 right-4 flex flex-col gap-3 z-10 w-[240px] md:w-[280px]">
           {/* Vídeo Remoto (Aluno ou Professor) */}
           <div className="relative aspect-[4/3] bg-zinc-900 rounded-xl overflow-hidden shadow-lg border border-zinc-800 flex items-center justify-center">
              <span className="absolute top-2 left-2 text-xs text-white/50 font-medium bg-black/50 px-1.5 py-0.5 rounded">
                  {role === 'host' ? 'Aluno' : 'Professor'}
              </span>
              {!remoteStream && (
                 <div className="text-zinc-500 flex flex-col items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center animate-pulse">
                        ⌛
                    </div>
                    <span className="text-xs">Conectando vídeo...</span>
                 </div>
              )}
              <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline
                  className="w-full h-full object-cover"
              />
           </div>

           {/* Vídeo Local (Você) */}
           <div className="relative aspect-[4/3] bg-zinc-900 rounded-xl overflow-hidden shadow-lg border border-zinc-800">
               <span className="absolute top-2 left-2 text-xs text-white/50 font-medium bg-black/50 px-1.5 py-0.5 rounded">Você</span>
               {!isCamOn && (
                   <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                       <span className="text-sm">Câmera desligada</span>
                   </div>
               )}
               <video 
                ref={localVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className={`w-full h-full object-cover transform scale-x-[-1] ${!isCamOn ? 'invisible' : ''}`} 
               />
           </div>

           {/* Controles da Chamada */}
           <div className="flex justify-center gap-2 bg-white/90 backdrop-blur-md p-2 rounded-xl shadow-lg border border-slate-200">
               <button 
                onClick={() => setIsCamOn(!isCamOn)}
                className={`p-2 rounded-full transition-colors ${!isCamOn ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title="Ligar/Desligar Câmera"
               >
                   {isCamOn ? <CameraIcon className="w-5 h-5" /> : <CameraOffIcon className="w-5 h-5" />}
               </button>

               <button 
                onClick={() => setIsMicOn(!isMicOn)}
                className={`p-2 rounded-full transition-colors ${!isMicOn ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                title="Ligar/Desligar Microfone"
               >
                   {isMicOn ? <MicIcon className="w-5 h-5" /> : <MicOffIcon className="w-5 h-5" />}
               </button>

               <div className="w-px bg-slate-200 mx-1"></div>

               <button 
                onClick={() => { window.history.replaceState({}, '', '/'); window.location.reload(); }}
                className="p-2 rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                title="Sair da Aula"
               >
                   <ExitIcon className="w-5 h-5" />
               </button>
           </div>
      </div>

      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        lineWidth={lineWidth}
        setLineWidth={setLineWidth}
        undo={() => {}} 
        redo={() => {}} 
        clear={handleClear}
        onImportPdf={handleImportPdf}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </div>
  );
};

export default App;
