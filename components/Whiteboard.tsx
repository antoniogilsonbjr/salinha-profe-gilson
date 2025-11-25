import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Tool, Path, Point, CanvasElement, PathElement, ImageElement } from '../types';

interface WhiteboardProps {
  tool: Tool;
  color: string;
  lineWidth: number;
  elements: CanvasElement[];
  setElements: React.Dispatch<React.SetStateAction<CanvasElement[]>>;
  setUndoStack: React.Dispatch<React.SetStateAction<CanvasElement[]>>;
}

type Action = 'none' | 'drawing' | 'panning' | 'resizing' | 'moving';
type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const Whiteboard: React.FC<WhiteboardProps> = ({ tool, color, lineWidth, elements, setElements, setUndoStack }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentPathRef = useRef<Path | null>(null);
  const actionRef = useRef<Action>('none');
  const panStartRef = useRef({ x: 0, y: 0 });
  const moveStartRef = useRef({ x: 0, y: 0 });
  const resizeHandleRef = useRef<ResizeHandle | null>(null);

  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [viewTransform, setViewTransform] = useState({ scale: 1, offset: { x: 0, y: 0 } });

  // Limpa a seleção se a ferramenta mudar para algo que não seja 'select'
  useEffect(() => {
    if (tool !== 'select') {
      setSelectedElementId(null);
    }
  }, [tool]);

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext('2d') : null;
  }, []);

  const drawPath = useCallback((ctx: CanvasRenderingContext2D, path: Path) => {
    ctx.beginPath();
    
    // Set opacity for highlighter
    ctx.globalAlpha = path.tool === 'highlighter' ? 0.5 : 1.0;
    
    ctx.strokeStyle = path.tool === 'eraser' ? '#FFFFFF' : path.color;
    ctx.lineWidth = path.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (path.points.length > 0) {
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
    }
    ctx.stroke();
    // Reset opacity
    ctx.globalAlpha = 1.0;
  }, []);

  const redrawCanvas = useCallback(() => {
    const ctx = getCanvasContext();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.translate(viewTransform.offset.x * dpr, viewTransform.offset.y * dpr);
    ctx.scale(viewTransform.scale * dpr, viewTransform.scale * dpr);

    elements.forEach(element => {
      if (element.type === 'path') {
        drawPath(ctx, element.path);
      } else if (element.type === 'image') {
        ctx.drawImage(element.image, element.x, element.y, element.width, element.height);
      }
    });

    if (currentPathRef.current) {
        drawPath(ctx, currentPathRef.current);
    }
    
    // Desenha a seleção e controles apenas se a ferramenta for 'select'
    if (tool === 'select') {
      const selectedElement = elements.find(el => el.id === selectedElementId);
      if (selectedElement && selectedElement.type === 'image') {
        const el = selectedElement;
        const isLocked = !!el.locked;

        // Borda de seleção (Azul se livre, Vermelho se trancado)
        ctx.strokeStyle = isLocked ? '#EF4444' : '#0099ff';
        ctx.lineWidth = 1 / viewTransform.scale;
        ctx.setLineDash(isLocked ? [5, 5] : []); // Tracejado se trancado
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        ctx.setLineDash([]);
        
        // Desenhar alças de redimensionamento apenas se NÃO estiver trancado
        if (!isLocked) {
            const handleSize = 8 / viewTransform.scale;
            ctx.fillStyle = '#fff';
            
            const handles = [
              { x: el.x, y: el.y }, // top-left
              { x: el.x + el.width, y: el.y }, // top-right
              { x: el.x, y: el.y + el.height }, // bottom-left
              { x: el.x + el.width, y: el.y + el.height }, // bottom-right
            ];

            handles.forEach(handle => {
              ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
              ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
            });
        }

        // Desenhar Botão de Trancar (Sempre visível quando selecionado)
        const btnSize = 24 / viewTransform.scale;
        const padding = 8 / viewTransform.scale;
        const btnX = el.x + el.width - btnSize; 
        const btnY = el.y - btnSize - padding;

        ctx.fillStyle = 'white';
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.arc(btnX + btnSize/2, btnY + btnSize/2, btnSize/1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        
        // Desenha o ícone do cadeado simplificado
        ctx.fillStyle = isLocked ? '#EF4444' : '#4B5563';
        const iconScale = 1 / viewTransform.scale;
        ctx.save();
        ctx.translate(btnX, btnY);
        ctx.scale(iconScale, iconScale);
        
        // Ícone simplificado desenhado via canvas path para evitar carregar svg externo na renderização
        ctx.beginPath();
        if (isLocked) {
             // Cadeado Fechado
             ctx.fillRect(6, 10, 12, 10); // Corpo
             ctx.arc(12, 10, 5, Math.PI, 0); // Arco superior
             ctx.stroke();
             ctx.fill();
        } else {
             // Cadeado Aberto
             ctx.fillRect(6, 10, 12, 10);
             ctx.beginPath();
             ctx.arc(12, 10, 5, Math.PI, 0); // Arco
             ctx.stroke(); // Apenas contorno no arco ou deslocado
             // Desenho "aberto": desloca a alça
             ctx.clearRect(6, 4, 6, 6); // gambiarra visual simples
             ctx.beginPath();
             ctx.moveTo(17, 10);
             ctx.arc(12, 10, 5, 0, Math.PI, true);
             ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }, [elements, selectedElementId, viewTransform, getCanvasContext, drawPath, tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      redrawCanvas();
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [redrawCanvas]);
  
  useEffect(() => {
    redrawCanvas();
  }, [elements, viewTransform, redrawCanvas]);

  const getTransformedPoint = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewTransform.offset.x) / viewTransform.scale,
      y: (clientY - rect.top - viewTransform.offset.y) / viewTransform.scale,
    };
  };

  const getElementAtPoint = (point: Point): ImageElement | null => {
    for (let i = elements.length - 1; i >= 0; i--) {
        const element = elements[i];
        if (element.type === 'image') {
            if (point.x >= element.x && point.x <= element.x + element.width &&
                point.y >= element.y && point.y <= element.y + element.height) {
                return element;
            }
        }
    }
    return null;
  };
    
  const getPathAtPoint = (point: Point): PathElement | null => {
      for (let i = elements.length - 1; i >= 0; i--) {
          const element = elements[i];
          if (element.type === 'path') {
              const { points, lineWidth } = element.path;
              const threshold = (lineWidth / 2 + 5) / viewTransform.scale;

              for (let j = 0; j < points.length - 1; j++) {
                  const p1 = points[j];
                  const p2 = points[j+1];

                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const lenSq = dx * dx + dy * dy;

                  if (lenSq === 0) {
                     const dist = Math.hypot(point.x - p1.x, point.y - p1.y);
                     if (dist < threshold) return element;
                     continue;
                  }

                  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
                  t = Math.max(0, Math.min(1, t));
                  const closestX = p1.x + t * dx;
                  const closestY = p1.y + t * dy;
                  
                  const distance = Math.hypot(point.x - closestX, point.y - closestY);

                  if (distance < threshold) {
                      return element;
                  }
              }
          }
      }
      return null;
  };


  const getResizeHandleAtPoint = (point: Point, element: ImageElement): ResizeHandle | null => {
    const handleSize = 12 / viewTransform.scale;
    const handles = {
      'top-left': { x: element.x, y: element.y },
      'top-right': { x: element.x + element.width, y: element.y },
      'bottom-left': { x: element.x, y: element.y + element.height },
      'bottom-right': { x: element.x + element.width, y: element.y + element.height },
    };

    for (const [name, pos] of Object.entries(handles)) {
      if (Math.abs(point.x - pos.x) < handleSize / 2 && Math.abs(point.y - pos.y) < handleSize / 2) {
        return name as ResizeHandle;
      }
    }
    return null;
  };

  const isPointInLockButton = (point: Point, element: ImageElement): boolean => {
    const btnSize = 24 / viewTransform.scale;
    const padding = 8 / viewTransform.scale;
    const btnX = element.x + element.width - btnSize; 
    const btnY = element.y - btnSize - padding;
    
    // Aumenta a área de clique
    const hitPadding = 10 / viewTransform.scale;

    return (
        point.x >= btnX - hitPadding &&
        point.x <= btnX + btnSize + hitPadding &&
        point.y >= btnY - hitPadding &&
        point.y <= btnY + btnSize + hitPadding
    );
  };

  const startDrawing = (e: {clientX: number, clientY: number}) => {
    actionRef.current = 'drawing';
    const startPoint = getTransformedPoint(e.clientX, e.clientY);
    currentPathRef.current = {
      points: [startPoint],
      color,
      lineWidth: tool === 'eraser' ? lineWidth : lineWidth,
      tool: tool === 'select' ? 'pen' : tool, // Fallback safe
    };
    setUndoStack([]);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const point = getTransformedPoint(e.clientX, e.clientY);
    if (e.button === 1) { // Middle mouse for panning
      actionRef.current = 'panning';
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 0) { // Left mouse
      if (tool === 'stroke-eraser') {
        const pathToDelete = getPathAtPoint(point);
        if (pathToDelete) {
          setElements(prev => prev.filter(el => el.id !== pathToDelete.id));
          setUndoStack([]);
        } else {
             // Tentar apagar imagem se não estiver trancada
             const imgToDelete = getElementAtPoint(point);
             if (imgToDelete && !imgToDelete.locked) {
                 setElements(prev => prev.filter(el => el.id !== imgToDelete.id));
                 setUndoStack([]);
             }
        }
        return;
      }

      // Lógica exclusiva para a ferramenta de seleção
      if (tool === 'select') {
        const selectedElement = elements.find(el => el.id === selectedElementId && el.type === 'image') as ImageElement | undefined;
        
        // Verifica se clicou no botão de lock do elemento selecionado
        if (selectedElement) {
            if (isPointInLockButton(point, selectedElement)) {
                // Toggle Lock
                setElements(prev => prev.map(el => {
                    if (el.id === selectedElement.id && el.type === 'image') {
                        return { ...el, locked: !el.locked };
                    }
                    return el;
                }));
                return; // Impede deseleção ou movimento
            }

            // Verifica handles de redimensionamento (apenas se não estiver trancado)
            if (!selectedElement.locked) {
                const handle = getResizeHandleAtPoint(point, selectedElement);
                if (handle) {
                    actionRef.current = 'resizing';
                    resizeHandleRef.current = handle;
                    return;
                }
            }
        }

        // Verifica clique no corpo da imagem
        const elementUnderMouse = getElementAtPoint(point);
        if (elementUnderMouse) {
          setSelectedElementId(elementUnderMouse.id);
          // Só permite mover se não estiver trancado
          if (!elementUnderMouse.locked) {
              actionRef.current = 'moving';
              moveStartRef.current = point;
          }
        } else {
          // Clique fora desmarca
          setSelectedElementId(null);
        }
        return;
      }

      // Se não for select, eraser ou stroke-eraser, é desenho
      setSelectedElementId(null);
      startDrawing(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const point = getTransformedPoint(e.clientX, e.clientY);
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (tool === 'stroke-eraser') {
      const pathHit = getPathAtPoint(point);
      const imgHit = getElementAtPoint(point);
      // Cursor pointer se houver algo para apagar (imagem deve não estar trancada)
      const canErase = pathHit || (imgHit && !imgHit.locked);
      canvas.style.cursor = canErase ? 'pointer' : 'default';
      return;
    }

    if (tool === 'select') {
      const selectedElement = elements.find(el => el.id === selectedElementId && el.type === 'image') as ImageElement | undefined;
      
      // Cursor para botão de lock
      if (selectedElement && isPointInLockButton(point, selectedElement)) {
          canvas.style.cursor = 'pointer';
          return;
      }

      if (selectedElement && !selectedElement.locked) {
        const handle = getResizeHandleAtPoint(point, selectedElement);
        if (handle === 'top-left' || handle === 'bottom-right') canvas.style.cursor = 'nwse-resize';
        else if (handle === 'top-right' || handle === 'bottom-left') canvas.style.cursor = 'nesw-resize';
        else if (getElementAtPoint(point)) canvas.style.cursor = 'move';
        else canvas.style.cursor = 'default';
      } else {
         const el = getElementAtPoint(point);
         if (el) {
             // Mostra cursor de movimento se não trancado, ou default/not-allowed se trancado
             canvas.style.cursor = el.locked ? 'default' : 'move';
         } else {
             canvas.style.cursor = 'default';
         }
      }
    } else {
      canvas.style.cursor = (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') ? 'crosshair' : 'default';
    }

    switch (actionRef.current) {
      case 'panning': {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setViewTransform(prev => ({ ...prev, offset: { x: prev.offset.x + dx, y: prev.offset.y + dy } }));
        panStartRef.current = { x: e.clientX, y: e.clientY };
        break;
      }
      case 'drawing': {
        if (!currentPathRef.current) return;
        currentPathRef.current.points.push(point);
        redrawCanvas();
        break;
      }
      case 'moving': {
        const dx = point.x - moveStartRef.current.x;
        const dy = point.y - moveStartRef.current.y;
        setElements(prev => prev.map(el => {
          if (el.id === selectedElementId && el.type === 'image') {
              // Verificação extra de segurança
              if (el.locked) return el; 
              return { ...el, x: el.x + dx, y: el.y + dy };
          }
          return el;
        }));
        moveStartRef.current = point; // Atualiza para movimento contínuo relativo
        break;
      }
      case 'resizing': {
        setElements(prev => prev.map(el => {
          if (el.id === selectedElementId && el.type === 'image') {
            if (el.locked) return el;

            const minSize = 20;
            const ar = el.width / el.height;
            let newX = el.x;
            let newY = el.y;
            let newW = el.width;
            let newH = el.height;

            const mouseX = point.x;
            const mouseY = point.y;

            switch (resizeHandleRef.current) {
              case 'top-left': {
                const anchorX = el.x + el.width;
                const anchorY = el.y + el.height;
                let w = anchorX - mouseX;
                let h = anchorY - mouseY;
                if (w < minSize) w = minSize;
                if (h < minSize / ar) h = minSize / ar;
                if (w / h > ar) { newW = w; newH = w / ar; } else { newH = h; newW = h * ar; }
                newX = anchorX - newW;
                newY = anchorY - newH;
                break;
              }
              case 'top-right': {
                const anchorX = el.x;
                const anchorY = el.y + el.height;
                let w = mouseX - anchorX;
                let h = anchorY - mouseY;
                if (w < minSize) w = minSize;
                if (h < minSize / ar) h = minSize / ar;
                if (w / h > ar) { newW = w; newH = w / ar; } else { newH = h; newW = h * ar; }
                newX = anchorX;
                newY = anchorY - newH;
                break;
              }
              case 'bottom-left': {
                const anchorX = el.x + el.width;
                const anchorY = el.y;
                let w = anchorX - mouseX;
                let h = mouseY - anchorY;
                if (w < minSize) w = minSize;
                if (h < minSize / ar) h = minSize / ar;
                if (w / h > ar) { newW = w; newH = w / ar; } else { newH = h; newW = h * ar; }
                newX = anchorX - newW;
                newY = anchorY;
                break;
              }
              case 'bottom-right': {
                const anchorX = el.x;
                const anchorY = el.y;
                let w = mouseX - anchorX;
                let h = mouseY - anchorY;
                if (w < minSize) w = minSize;
                if (h < minSize / ar) h = minSize / ar;
                if (w / h > ar) { newW = w; newH = w / ar; } else { newH = h; newW = h * ar; }
                newX = anchorX;
                newY = anchorY;
                break;
              }
            }
            
            return { ...el, x: newX, y: newY, width: newW, height: newH };
          }
          return el;
        }));
        break;
      }
    }
  };

  const handleMouseUp = () => {
    if (actionRef.current === 'drawing' && currentPathRef.current && currentPathRef.current.points.length > 1) {
      const scaledPath = {
        ...currentPathRef.current,
        lineWidth: currentPathRef.current.lineWidth / viewTransform.scale,
      };
      const newElement: PathElement = { type: 'path', id: Date.now().toString(), path: scaledPath };
      setElements(prev => [...prev, newElement]);
    }
    if (actionRef.current === 'resizing' || actionRef.current === 'moving') {
        setUndoStack([]);
    }
    actionRef.current = 'none';
    currentPathRef.current = null;
    resizeHandleRef.current = null;
  };
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const { clientX, clientY, deltaY } = e;
        const rect = canvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        const scaleMultiplier = 1 - deltaY * 0.001;
        const newScale = Math.max(0.1, Math.min(10, viewTransform.scale * scaleMultiplier));
        const newOffsetX = mouseX - (mouseX - viewTransform.offset.x) * (newScale / viewTransform.scale);
        const newOffsetY = mouseY - (mouseY - viewTransform.offset.y) * (newScale / viewTransform.scale);
        
        setViewTransform({ scale: newScale, offset: { x: newOffsetX, y: newOffsetY } });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [viewTransform]);

  useEffect(() => {
      const handlePaste = (e: ClipboardEvent) => {
          const items = e.clipboardData?.items;
          if (!items || !canvasRef.current) return;
          for (const item of Array.from(items)) {
              if (item.type.indexOf('image') !== -1) {
                  const file = item.getAsFile();
                  if (!file) continue;

                  const imageUrl = URL.createObjectURL(file);
                  const image = new Image();
                  image.onload = () => {
                      const canvas = canvasRef.current!;
                      const rect = canvas.getBoundingClientRect();
                      const targetWidth = Math.min(image.width, rect.width * 0.5);
                      const scale = targetWidth / image.width;
                      const targetHeight = image.height * scale;
                      const centerPoint = getTransformedPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                      
                      const newImageElement: ImageElement = {
                          type: 'image',
                          id: Date.now().toString(),
                          image: image,
                          x: centerPoint.x - (targetWidth / viewTransform.scale) / 2,
                          y: centerPoint.y - (targetHeight / viewTransform.scale) / 2,
                          width: targetWidth / viewTransform.scale,
                          height: targetHeight / viewTransform.scale,
                          locked: false, // Default unlocked
                      };
                      setElements(prev => [...prev, newImageElement]);
                      URL.revokeObjectURL(imageUrl);
                  };
                  image.src = imageUrl;
                  e.preventDefault();
                  return;
              }
          }
      };
      window.addEventListener('paste', handlePaste);
      return () => window.removeEventListener('paste', handlePaste);
  }, [setElements, viewTransform, getTransformedPoint]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 w-full h-full bg-white"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={(e) => {
        const point = getTransformedPoint(e.touches[0].clientX, e.touches[0].clientY);
        if (tool === 'stroke-eraser') {
            const pathToDelete = getPathAtPoint(point);
            if (pathToDelete) {
                setElements(prev => prev.filter(el => el.id !== pathToDelete.id));
                setUndoStack([]);
            }
        } else if (tool === 'select') {
           const el = getElementAtPoint(point);
           if (el) setSelectedElementId(el.id);
           else setSelectedElementId(null);
           
           // Toggle lock on touch via simple tap if selected might be tricky without double tap logic,
           // but keeping simple selection for now. 
           // Future improvement: Show a DOM overlay for controls on mobile.
        } else {
            startDrawing(e.touches[0]);
        }
      }}
      onTouchMove={(e) => {
        e.preventDefault();
        if (actionRef.current === 'drawing' && currentPathRef.current) {
          const point = getTransformedPoint(e.touches[0].clientX, e.touches[0].clientY);
          currentPathRef.current.points.push(point);
          redrawCanvas();
        }
      }}
      onTouchEnd={handleMouseUp}
    />
  );
};

export default Whiteboard;
