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

  // 初始化检查授权状态
  useEffect(() => {
    const checkKeyStatus = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const isSelected = await aistudio.hasSelectedApiKey();
        setHasKey(isSelected);
      }
    };
    checkKeyStatus();
  }, []);

  const handleOpenKeySelector = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      await aistudio.openSelectKey();
      // 触发授权弹窗后，乐观假设授权成功，后续报错会通过 API 调用逻辑重新置为 false
      setHasKey(true);
      setErrorMsg(null);
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
      setErrorMsg("请描述故障或上传图片");
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
          `【历史案例 ${index + 1}】设备: ${item.name}\n现象: ${item.description}\n方案: ${item.analysis || '无'}`
        ).join('\n---\n');
      }

      const result = await analyzeRepairIssue(finalDesc, apiImages, kbContext);
      setAnalysisResult(result);
      setAppState(AppState.SUCCESS);
    } catch (err: any) {
      if (err.message === "API_KEY_INVALID" || err.message === "API_KEY_MISSING") {
        setHasKey(false);
        setErrorMsg("API Key 授权失效，请点击下方按钮重新授权。");
      } else {
        setErrorMsg(err.message || "分析失败，请检查网络或重试。");
      }
      setAppState(AppState.ERROR);
    }
  };

  const resetApp = () => {
    setAppState(AppState.IDLE);
    setAnalysisResult(null);
    setImages([]);
    setDescription('');
    setIsLibraryView(false);
  };

  if (!hasKey) {
    return (
      <div className="min-h-screen bg-tech-blue flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 border border-gray-700 rounded-3xl p-8 text-center shadow-2xl animate-fade-in">
          <div className="w-20 h-20 bg-circuit-teal/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <IconCpu className="w-10 h-10 text-circuit-teal" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">专家系统需要授权</h2>
          <p className="text-gray-400 mb-8">
            本应用使用 <strong>Gemini 3 Pro</strong> 深度诊断模型。请选择您的 API Key 以开始。
          </p>
          <button 
            onClick={handleOpenKeySelector}
            className="w-full py-4 bg-circuit-teal hover:bg-teal-400 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-teal-900/20 active:scale-95 mb-6"
          >
            立即授权诊断引擎
          </button>
          <p className="text-xs text-gray-500">
            需使用付费项目的 API Key。<a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline hover:text-circuit-teal">计费详情</a>
          </p>
        </div>
      </div>
    );
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    setErrorMsg(null);
    if (fileName.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target?.result as string);
          if (Array.isArray(json)) processLibraryData(json);
        } catch (err) { setErrorMsg("JSON 格式错误"); }
      };
      reader.readAsText(file);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
          processLibraryData(jsonData);
        } catch (err) { setErrorMsg("Excel 解析失败"); }
      };
      reader.readAsArrayBuffer(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processLibraryData = (data: any[]) => {
    const items: LibraryItem[] = data.map((item: any, index) => {
      const findVal = (keys: string[]) => {
        const match = Object.keys(item).find(k => keys.includes(k.toLowerCase()));
        return match ? String(item[match]).trim() : undefined;
      };
      const desc = findVal(['description', '描述', '故障', '现象', 'issue']);
      if (!desc) return null;
      return {
        id: `lib-${Date.now()}-${index}`,
        name: findVal(['name', '设备', '型号', 'title']) || '未知设备',
        category: '历史存档',
        description: desc,
        analysis: findVal(['analysis', '方案', '处理', 'solution'])
      };
    }).filter(Boolean) as LibraryItem[];
    setLibraryItems(items);
  };

  const selectLibraryItem = (item: LibraryItem) => {
    setDescription(item.description);
    if (item.analysis) {
      setAnalysisResult({
        diagnosis: "Archive",
        rawText: `## ${item.name} - 存档方案\n\n**故障现象**：${item.description}\n\n---\n\n### 📚 历史存档方案\n\n${item.analysis}`,
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
    <div className="min-h-screen flex flex-col bg-tech-blue text-slate-200">
      <header className="border-b border-gray-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => { setViewMode('diagnose'); resetApp(); }}>
            <div className="bg-circuit-teal/20 p-2 rounded-lg"><IconCpu className="w-6 h-6 text-circuit-teal" /></div>
            <h1 className="text-xl font-bold tracking-tight text-white">产品部维修<span className="text-circuit-teal">专家</span></h1>
          </div>
          <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg">
             <button onClick={() => setViewMode('diagnose')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'diagnose' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>智能诊断</button>
             <button onClick={() => setViewMode('library')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${viewMode === 'library' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>案例库</button>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto px-4 py-8 max-w-4xl">
        {viewMode === 'diagnose' ? (
          <div className="animate-fade-in space-y-8">
            {(appState === AppState.IDLE || appState === AppState.ERROR) && (
              <div className="space-y-8">
                <div className="text-center space-y-3">
                  <h2 className="text-3xl font-extrabold text-white">智能<span className="text-circuit-teal">电路诊断</span>引擎</h2>
                  <p className="text-gray-400">输入故障现象或上传 PCB 写真，由 AI 结合技术手册输出维修方案。</p>
                </div>
                <div className="bg-slate-800/50 border border-gray-700 rounded-3xl p-6 md:p-8 shadow-xl">
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-400 mb-2">问题描述</label>
                    <textarea 
                      value={description} 
                      onChange={(e) => setDescription(e.target.value)} 
                      className="w-full bg-slate-900 border border-gray-700 rounded-2xl p-4 text-white focus:ring-2 focus:ring-circuit-teal outline-none h-32 transition-all"
                      placeholder="例如：电源主控板通电无反应，F1保险丝完好，量测电容无电压..."
                    />
                  </div>
                  <div className="mb-8">
                    <label className="block text-sm font-medium text-gray-400 mb-2">实地照片</label>
                    <div className="flex flex-wrap gap-3">
                      <div onClick={() => imageInputRef.current?.click()} className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:border-circuit-teal text-gray-500 hover:text-circuit-teal transition-all">
                        <IconCamera className="w-6 h-6 mb-1" /><span className="text-[10px]">添加照片</span>
                        <input type="file" ref={imageInputRef} accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                      </div>
                      {images.map((img) => (
                        <div key={img.id} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-700 group">
                          <img src={`data:${img.mimeType};base64,${img.data}`} alt="fault" className="w-full h-full object-cover" />
                          <button onClick={() => removeImage(img.id)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100"><IconX className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  {errorMsg && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-200 text-sm flex items-center gap-3">
                      <IconAlert className="w-5 h-5 flex-shrink-0" />
                      <div>
                        {errorMsg}
                        {!hasKey && <button onClick={handleOpenKeySelector} className="ml-2 underline font-bold">立即重新授权</button>}
                      </div>
                    </div>
                  )}
                  <button onClick={() => handleSubmit()} className="w-full py-4 bg-circuit-teal hover:bg-teal-400 text-slate-900 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-all">开始 AI 诊断</button>
                </div>
              </div>
            )}

            {appState === AppState.ANALYZING && (
              <div className="py-20 flex flex-col items-center">
                <div className="relative w-24 h-24 mb-6">
                  <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-t-circuit-teal rounded-full animate-spin"></div>
                  <div className="absolute inset-4 bg-slate-800 rounded-full flex items-center justify-center animate-pulse"><IconCpu className="w-8 h-8 text-circuit-teal" /></div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">专家引擎深度计算中...</h3>
                <p className="text-gray-400">正在匹配历史案例库并搜索互联网相关原理图</p>
              </div>
            )}

            {appState === AppState.SUCCESS && analysisResult && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                    <span className="p-2 bg-circuit-teal/10 text-circuit-teal rounded-lg border border-circuit-teal/20"><IconWrench className="w-5 h-5" /></span>
                    诊断报告
                  </h2>
                  <button onClick={resetApp} className="text-sm text-gray-500 hover:text-white transition-colors">查询新故障</button>
                </div>
                <div className="bg-slate-800 border border-gray-700 rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-circuit-teal to-blue-500"></div>
                  <MarkdownRenderer content={analysisResult.rawText} />
                </div>
                {analysisResult.sources.length > 0 && (
                  <div className="p-4 bg-slate-900/50 rounded-2xl border border-gray-800">
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2"><IconLink className="w-3 h-3" /> 参考资源</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {analysisResult.sources.map((s, i) => s.web && (
                        <a key={i} href={s.web.uri} target="_blank" rel="noreferrer" className="text-sm text-circuit-teal hover:underline truncate bg-slate-800 p-2 rounded-lg border border-gray-700">{s.web.title}</a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in space-y-6">
            <div className="bg-slate-800/50 border border-gray-700 rounded-3xl p-8 text-center">
              <h3 className="text-xl font-bold text-white mb-4">导入产品部历史库</h3>
              <p className="text-gray-400 mb-8 text-sm">导入 Excel 或 JSON 维修记录，AI 诊断时会优先匹配这些实战经验。</p>
              <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-gray-600 rounded-2xl p-12 hover:border-circuit-teal hover:bg-slate-800/50 cursor-pointer transition-all group">
                <IconFileText className="w-12 h-12 text-gray-600 group-hover:text-circuit-teal mx-auto mb-4" />
                <p className="font-bold">点击选择库文件</p>
                <input type="file" ref={fileInputRef} accept=".json,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              </div>
            </div>
            {libraryItems.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {libraryItems.map(item => (
                  <div key={item.id} onClick={() => selectLibraryItem(item)} className="bg-slate-800 border border-gray-700 p-5 rounded-2xl hover:border-circuit-teal cursor-pointer group transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="text-white font-bold group-hover:text-circuit-teal transition-colors">{item.name}</h4>
                      {item.analysis && <span className="text-[10px] bg-green-900/40 text-green-400 px-2 py-0.5 rounded border border-green-800">有方案</span>}
                    </div>
                    <p className="text-gray-500 text-xs line-clamp-2">{item.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="py-8 border-t border-gray-800 text-center text-[10px] text-gray-600 uppercase tracking-widest">
        © {new Date().getFullYear()} 产品部维修专家 · 基于授权访问模式
      </footer>
    </div>
  );
};

export default App;
