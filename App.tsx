
import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  IconCpu, 
  IconWrench, 
  IconAlert, 
  IconSearch, 
  IconLink,
  IconUpload,
  IconFileText,
  IconList,
  IconCamera,
  IconX
} from './components/Icons';
import { analyzeRepairIssue } from './services/geminiService';
import { AppState, RepairAnalysis } from './types';
import MarkdownRenderer from './components/MarkdownRenderer';

// Removed explicit declaration of window.aistudio to avoid conflicts with ambient types like AIStudio
// Instead, we use (window as any).aistudio to access the pre-configured object.

type ViewMode = 'diagnose' | 'library';

interface LibraryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  analysis?: string;
}

interface ImageAttachment {
    id: string;
    data: string;
    mimeType: string;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [viewMode, setViewMode] = useState<ViewMode>('diagnose');
  const [hasKey, setHasKey] = useState<boolean>(true);
  
  // Diagnosis State
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [analysisResult, setAnalysisResult] = useState<RepairAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLibraryView, setIsLibraryView] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  // Library State
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 初始化检查 API Key
  useEffect(() => {
    const checkKey = async () => {
      // Accessing aistudio via casting to any to satisfy TypeScript while avoiding type clashes
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const selected = await aistudio.hasSelectedApiKey();
        setHasKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    // Accessing aistudio via casting to any to satisfy TypeScript while avoiding type clashes
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      await aistudio.openSelectKey();
      // Assume success after triggering key selection dialog to avoid race conditions
      setHasKey(true); 
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;
      Array.from(files).forEach((file: File) => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64String = (reader.result as string).split(',')[1];
              setImages(prev => [...prev, {
                  id: Date.now() + Math.random().toString(),
                  data: base64String,
                  mimeType: file.type
              }]);
          };
          reader.readAsDataURL(file);
      });
      if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const removeImage = (id: string) => {
      setImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSubmit = async (overrideDescription?: string) => {
    const finalDesc = overrideDescription || description;
    if (!finalDesc.trim() && images.length === 0) {
        setErrorMsg("请描述问题或上传故障图片");
        return;
    }

    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setIsLibraryView(false);

    try {
      const apiImages = images.map(img => ({ data: img.data, mimeType: img.mimeType }));
      let kbContext = undefined;
      if (libraryItems.length > 0) {
          kbContext = libraryItems.map((item, index) => 
            `【案例 ${index + 1}】\n设备/型号: ${item.name}\n现象: ${item.description}\n方案: ${item.analysis || '无'}`
          ).join('\n---\n');
      }

      const result = await analyzeRepairIssue(finalDesc, apiImages, kbContext);
      setAnalysisResult(result);
      setAppState(AppState.SUCCESS);
    } catch (err: any) {
      if (err.message === "API_KEY_INVALID") {
        setHasKey(false);
        setErrorMsg("API Key 已失效或未找到，请重新授权。");
      } else {
        setErrorMsg(err.message || "分析失败，请检查网络连接");
      }
      setAppState(AppState.ERROR);
    }
  };

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-tech-blue flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 border border-gray-700 rounded-3xl p-8 text-center shadow-2xl">
          <div className="w-20 h-20 bg-circuit-teal/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <IconCpu className="w-10 h-10 text-circuit-teal" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">专家系统访问受限</h2>
          <p className="text-gray-400 mb-8 leading-relaxed">
            为了访问 <strong>Gemini 3.0 Pro</strong> 专家诊断引擎，您需要先授权您的 API Key。
          </p>
          <button 
            onClick={handleOpenKeySelector}
            className="w-full py-4 bg-circuit-teal hover:bg-teal-400 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-teal-900/20 mb-4"
          >
            授权 API Key
          </button>
          <p className="text-xs text-gray-500">
            需要使用已开启计费的 Google Cloud 项目 Key。<br/>
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline hover:text-circuit-teal">了解计费说明</a>
          </p>
        </div>
      </div>
    );
  }

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setAnalysisResult(null);
    setImages([]);
    setDescription('');
    setIsLibraryView(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    setErrorMsg(null);
    if (fileName.endsWith('.json')) {
        handleJsonUpload(file);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        handleExcelUpload(file);
    } else {
        setErrorMsg("不支持的文件格式。请上传 JSON 或 Excel 文件。");
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleJsonUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const json = JSON.parse(content);
        if (!Array.isArray(json)) throw new Error("格式错误");
        processLibraryData(json);
      } catch (err: any) {
        setErrorMsg(`解析失败`);
      }
    };
    reader.readAsText(file);
  };

  const handleExcelUpload = (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const data = new Uint8Array(e.target?.result as ArrayBuffer);
              const workbook = XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet);
              processLibraryData(jsonData);
          } catch (err: any) {
              setErrorMsg(`Excel 解析失败`);
          }
      };
      reader.readAsArrayBuffer(file);
  };

  const findValue = (item: any, keys: string[]): string | undefined => {
      const itemKeys = Object.keys(item);
      for (const key of keys) {
          const match = itemKeys.find(k => k.toLowerCase() === key.toLowerCase());
          if (match && item[match]) return String(item[match]).trim();
      }
      return undefined;
  };

  const processLibraryData = (data: any[]) => {
      const items: LibraryItem[] = data.map((item: any, index) => {
             const desc = findValue(item, ['description', '描述', '故障', '故障描述', '问题', '现象', 'issue']);
             if (!desc) return null;
             const name = findValue(item, ['name', '名称', '设备', '设备名称', '器件', '标题', 'title']) || '未知设备';
             const analysis = findValue(item, ['analysis', '分析', '问题分析', '解决方案', '维修方案', '处理方法', 'solution', 'fix']);
             return { id: `lib-${Date.now()}-${index}`, name, category: '历史存档', description: desc, analysis };
        }).filter(Boolean) as LibraryItem[];
        setLibraryItems(items);
  };

  const selectLibraryItem = (item: LibraryItem) => {
    setDescription(item.description);
    setImages([]); 
    if (item.analysis) {
        setAnalysisResult({
            diagnosis: "Archive",
            rawText: `## ${item.name} - 存档方案\n\n**故障描述**：${item.description}\n\n---\n\n### 📚 知识库存档方案\n\n${item.analysis}`,
            sources: []
        });
        setAppState(AppState.SUCCESS);
        setIsLibraryView(true);
    } else {
        handleSubmit(item.description);
    }
    setViewMode('diagnose');
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-tech-blue">
      <header className="relative z-10 border-b border-gray-800 bg-slate-900/80 backdrop-blur-md sticky top-0">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-circuit-teal cursor-pointer" onClick={() => { setViewMode('diagnose'); resetApp(); }}>
            <div className="bg-circuit-teal/20 p-2 rounded-lg"><IconCpu className="w-6 h-6" /></div>
            <h1 className="text-2xl font-bold tracking-tight text-white">产品部维修<span className="text-circuit-teal">专家</span></h1>
          </div>
          <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg">
             <button onClick={() => setViewMode('diagnose')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'diagnose' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>智能诊断</button>
             <button onClick={() => setViewMode('library')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'library' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>问题库</button>
          </div>
        </div>
      </header>

      <main className="flex-grow relative z-10 container mx-auto px-4 py-8 max-w-4xl">
        {viewMode === 'diagnose' && (
            <>
                {(appState === AppState.IDLE || appState === AppState.ERROR) && (
                    <div className="space-y-8 animate-fade-in">
                        <div className="text-center space-y-4 mb-12">
                            <h2 className="text-3xl md:text-4xl font-extrabold text-white">
                                智能<span className="text-transparent bg-clip-text bg-gradient-to-r from-circuit-teal to-blue-500">电子维修专家</span>
                            </h2>
                            <p className="text-gray-400 max-w-2xl mx-auto text-lg">AI 深度学习您的自建知识库，并实时联网获取最新硬件原理图与故障指南。</p>
                        </div>
                        <div className="bg-slate-800/50 border border-gray-700 rounded-2xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-300 mb-2">故障描述</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-slate-900 border border-gray-700 rounded-xl p-4 text-white focus:ring-2 focus:ring-circuit-teal outline-none h-32 resize-none" placeholder="描述故障现象...系统将自动核对历史记录。" />
                            </div>
                            <div className="mb-8">
                                <label className="block text-sm font-medium text-gray-300 mb-2">上传故障照片</label>
                                <div className="flex flex-wrap gap-3">
                                    <div onClick={() => imageInputRef.current?.click()} className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:border-circuit-teal text-gray-500 hover:text-circuit-teal transition-all">
                                        <IconUpload className="w-6 h-6 mb-1" /><span className="text-xs">添加</span>
                                        <input type="file" ref={imageInputRef} accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                                    </div>
                                    {images.map((img) => (
                                        <div key={img.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-700 group">
                                            <img src={`data:${img.mimeType};base64,${img.data}`} alt="preview" className="w-full h-full object-cover" />
                                            <button onClick={() => removeImage(img.id)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100"><IconX className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {errorMsg && <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-200">{errorMsg}</div>}
                            <button onClick={() => handleSubmit()} className="w-full py-4 bg-gradient-to-r from-circuit-teal to-blue-600 text-white rounded-xl font-bold text-lg hover:brightness-110 shadow-lg">开始智能诊断</button>
                        </div>
                    </div>
                )}

                {appState === AppState.ANALYZING && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="relative w-24 h-24 mb-8">
                            <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-t-circuit-teal rounded-full animate-spin"></div>
                            <div className="absolute inset-4 bg-slate-800 rounded-full flex items-center justify-center animate-pulse"><IconCpu className="w-8 h-8 text-circuit-teal" /></div>
                        </div>
                        <h3 className="text-2xl font-bold text-white">专家系统正在思考...</h3>
                        <p className="text-gray-400">正在核对您的私有库并检索全球技术手册</p>
                    </div>
                )}

                {appState === AppState.SUCCESS && analysisResult && (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                <span className="p-2 bg-green-500/10 text-green-400 rounded-lg border border-green-500/20"><IconWrench className="w-5 h-5" /></span>
                                {isLibraryView ? "历史存档方案" : "专家诊断方案"}
                            </h2>
                            <button onClick={resetApp} className="text-sm text-gray-400 hover:text-white">诊断新故障</button>
                        </div>
                        <div className="bg-slate-800 border border-gray-700 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-circuit-teal to-blue-500"></div>
                            <MarkdownRenderer content={analysisResult.rawText} />
                        </div>
                    </div>
                )}
            </>
        )}

        {viewMode === 'library' && (
            <div className="space-y-8 animate-fade-in">
                <div className="bg-slate-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm">
                    <h3 className="text-xl font-bold text-white mb-6">导入历史记录库</h3>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-600 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-circuit-teal hover:bg-slate-800 group">
                        <IconFileText className="w-12 h-12 text-gray-500 group-hover:text-circuit-teal mb-4" />
                        <p className="text-white font-medium">选择 Excel 或 JSON 文件</p>
                        <input type="file" ref={fileInputRef} accept=".json, .xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                    </div>
                </div>
                {libraryItems.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-2">
                        {libraryItems.map((item) => (
                            <div key={item.id} onClick={() => selectLibraryItem(item)} className="bg-slate-800 border border-gray-700 p-6 rounded-xl hover:border-circuit-teal cursor-pointer transition-all">
                                <h4 className="text-white font-bold mb-2">{item.name}</h4>
                                <p className="text-gray-400 text-sm line-clamp-2">{item.description}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )}
      </main>

      <footer className="border-t border-gray-800 bg-slate-900/50 py-6">
        <div className="max-w-4xl mx-auto px-4 text-center text-gray-600 text-xs uppercase tracking-widest">
          © {new Date().getFullYear()} 产品部维修专家 · 授权访问模式
        </div>
      </footer>
    </div>
  );
};

export default App;
