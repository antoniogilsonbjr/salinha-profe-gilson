import React, { useState, useRef } from 'react';
import type { Tool } from '../types';
import { SelectIcon, PenIcon, HighlighterIcon, EraserIcon, StrokeEraserIcon, UndoIcon, RedoIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon, PdfIcon } from './icons/index';

// Paleta de 10 cores dispostas em 2 linhas
const COLORS = [
  '#000000', // Preto
  '#6B7280', // Cinza
  '#EF4444', // Vermelho
  '#F97316', // Laranja
  '#EAB308', // Amarelo Escuro
  '#22C55E', // Verde
  '#3B82F6', // Azul
  '#A855F7', // Roxo
  '#EC4899', // Rosa
  '#78350F', // Marrom
];

const LINE_WIDTHS = [2, 4, 6, 8, 12, 16, 24, 32];

interface ToolbarProps {
  tool: Tool;
  setTool: (tool: Tool) => void;
  color: string;
  setColor: (color: string) => void;
  lineWidth: number;
  setLineWidth: (width: number) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  onImportPdf: (file: File) => void;
  canUndo: boolean;
  canRedo: boolean;
}

const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  setTool,
  color,
  setColor,
  lineWidth,
  setLineWidth,
  undo,
  redo,
  clear,
  onImportPdf,
  canUndo,
  canRedo,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImportPdf(e.target.files[0]);
      // Limpa o input para permitir selecionar o mesmo arquivo novamente se necessário
      e.target.value = '';
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
      <div
        className={`flex items-center gap-3 bg-white p-2 rounded-xl shadow-lg border border-slate-200 transition-all duration-300 ease-in-out ${
          isVisible ? 'transform-none opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
        }`}
      >
        {/* Tool Selection */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTool('select')}
            className={`p-1.5 rounded-lg transition-colors ${tool === 'select' ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            title="Selecionar"
          >
            <SelectIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool('pen')}
            className={`p-1.5 rounded-lg transition-colors ${tool === 'pen' ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            title="Caneta"
          >
            <PenIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool('highlighter')}
            className={`p-1.5 rounded-lg transition-colors ${tool === 'highlighter' ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            title="Marca-texto"
          >
            <HighlighterIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTool('eraser')}
            className={`p-1.5 rounded-lg transition-colors ${tool === 'eraser' ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            title="Borracha"
          >
            <EraserIcon className="w-5 h-5" />
          </button>
           <button
            onClick={() => setTool('stroke-eraser')}
            className={`p-1.5 rounded-lg transition-colors ${tool === 'stroke-eraser' ? 'bg-slate-200' : 'hover:bg-slate-100'}`}
            title="Borracha de Traço"
          >
            <StrokeEraserIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="w-px h-10 bg-slate-200" />

        {/* Color Palette - Grid 2x5 */}
        <div className="grid grid-cols-5 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full transition-transform transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
              style={{ backgroundColor: c }}
              title={`Cor ${c}`}
            />
          ))}
        </div>

        <div className="w-px h-10 bg-slate-200" />

        {/* Line Width */}
        <div className="flex items-center gap-2">
            <label htmlFor="lineWidth" className="text-sm text-slate-600 sr-only">Espessura do Pincel</label>
            <input
                id="lineWidth"
                type="range"
                min="0"
                max={LINE_WIDTHS.length - 1}
                step="1"
                value={LINE_WIDTHS.indexOf(lineWidth)}
                onChange={(e) => setLineWidth(LINE_WIDTHS[parseInt(e.target.value, 10)])}
                className="w-20 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600"
                title={`Tamanho ${lineWidth}px`}
            />
            <span className="w-8 text-center text-xs font-medium text-slate-700">{lineWidth}px</span>
        </div>
        
        <div className="w-px h-10 bg-slate-200" />

        {/* Actions */}
        <div className="flex items-center gap-1">
           <button onClick={undo} disabled={!canUndo} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent" title="Desfazer">
            <UndoIcon className="w-5 h-5" />
          </button>
          <button onClick={redo} disabled={!canRedo} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent" title="Refazer">
            <RedoIcon className="w-5 h-5" />
          </button>
          <button onClick={clear} className="p-1.5 rounded-lg hover:bg-red-100 text-red-500" title="Limpar Tela">
            <TrashIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="w-px h-10 bg-slate-200" />
        
        {/* Import PDF */}
        <div className="flex items-center">
             <input
                type="file"
                accept="application/pdf"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
            />
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" 
                title="Importar PDF"
            >
                <PdfIcon className="w-5 h-5" />
            </button>
        </div>

      </div>
      
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="bg-white p-1.5 rounded-full shadow-lg border border-slate-200 hover:bg-slate-100 transition-colors"
        title={isVisible ? "Esconder ferramentas" : "Mostrar ferramentas"}
      >
        {isVisible ? <ChevronDownIcon className="w-5 h-5" /> : <ChevronUpIcon className="w-5 h-5" />}
      </button>
    </div>
  );
};

export default Toolbar;
