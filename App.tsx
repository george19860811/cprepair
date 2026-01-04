import React, { useState, useRef } from 'react';
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
  name: string;      // 设备名称/标题
  category: string;
  description: string;
  analysis?: string; // 现有的问题分析/维修方案
}

interface ImageAttachment {
    id: string;
    data: string; // Base64
    mimeType: string;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [viewMode, setViewMode] = useState<ViewMode>('diagnose');
  
  // Diagnosis State
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [analysisResult, setAnalysisResult] = useState<RepairAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLibraryView, setIsLibraryView] = useState(false); // Flag to indicate if we are viewing a library item
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  // Library State
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Diagnosis Logic ---

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      // Fix: Explicitly type 'file' as File to prevent it from being inferred as 'unknown'
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
      // Reset input
      if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const removeImage = (id: string) => {
      setImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSubmit = async () => {
    if (!description.trim() && images.length === 0) {
        setErrorMsg("请描述问题或上传故障图片");
        return;
    }

    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setIsLibraryView(false); // Reset library view flag when starting new analysis

    try {
      const apiImages = images.map(img => ({ data: img.data, mimeType: img.mimeType }));
      
      // Construct Knowledge Base Context
      // Flatten library items into a text format for the LLM
      let kbContext = undefined;
      if (libraryItems.length > 0) {
          kbContext = libraryItems.map((item, index) => 
            `[Case ${index + 1}] 设备名称: ${item.name} | 故障描述: ${item.description} | 存档方案: ${item.analysis || '无'}`
          ).join('\n---\n');
      }

      const result = await analyzeRepairIssue(description, apiImages, kbContext);
      setAnalysisResult(result);
      setAppState(AppState.SUCCESS);
    } catch (err: any) {
      setErrorMsg(err.message || "分析失败，请检查网络连接");
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

  // --- Library / File Upload Logic ---

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    // Reset error
    setErrorMsg(null);

    if (fileName.endsWith('.json')) {
        handleJsonUpload(file);
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        handleExcelUpload(file);
    } else {
        setErrorMsg("不支持的文件格式。请上传 JSON 或 Excel 文件。");
    }

    // Clear input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleJsonUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const json = JSON.parse(content);
        
        if (!Array.isArray(json)) {
          throw new Error("JSON 格式错误：根元素必须是数组");
        }
        processLibraryData(json);
      } catch (err: any) {
        setErrorMsg(`JSON 解析失败: ${err.message}`);
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
              
              if (workbook.SheetNames.length === 0) {
                  throw new Error("Excel 文件为空");
              }

              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet);
              
              processLibraryData(jsonData);
          } catch (err: any) {
              setErrorMsg(`Excel 解析失败: ${err.message}`);
          }
      };
      reader.readAsArrayBuffer(file);
  };

  // Helper to find value from multiple possible keys (case insensitive)
  const findValue = (item: any, keys: string[]): string | undefined => {
      const itemKeys = Object.keys(item);
      for (const key of keys) {
          const match = itemKeys.find(k => k.toLowerCase() === key.toLowerCase());
          if (match && item[match]) return String(item[match]).trim();
      }
      return undefined;
  };

  const processLibraryData = (data: any[]) => {
      let validCount = 0;
      const items: LibraryItem[] = data.map((item: any, index) => {
             // 1. Description (Mandatory)
             const desc = findValue(item, ['description', '描述', '故障', '故障描述', '问题', '现象', 'issue']);
             if (!desc) return null;

             // 2. Name (Optional, default to '未命名设备')
             const name = findValue(item, ['name', '名称', '设备', '设备名称', '器件', '标题', 'title']) || '未知设备';

             // 3. Category (Optional, default to '未分类')
             const cat = findValue(item, ['category', '分类', '类别', 'type']) || '未分类';

             // 4. Analysis/Solution (Optional)
             const analysis = findValue(item, ['analysis', '分析', '问题分析', '解决方案', '维修方案', '处理方法', 'solution', 'fix']);
             
             validCount++;
             return {
                 id: `lib-${Date.now()}-${index}`,
                 name: name,
                 category: cat,
                 description: desc,
                 analysis: analysis
             };
        }).filter(Boolean) as LibraryItem[];

        if (validCount === 0) {
            setErrorMsg("未找到有效数据。请确保文件中包含“故障描述”相关列。");
            return;
        }

        setLibraryItems(items);
        setErrorMsg(null); // Clear previous errors if successful
  };

  const selectLibraryItem = (item: LibraryItem) => {
    setDescription(item.description);
    setImages([]); // Clear images when selecting from library
    
    if (item.analysis) {
        // If the item already has an analysis/solution, show it directly in SUCCESS state
        // But mark it as a "Library View" so we can offer to Re-analyze
        setAnalysisResult({
            diagnosis: "Library Archive",
            rawText: `## ${item.name} - 存档方案\n\n**故障描述**：${item.description}\n\n---\n\n### 📚 问题分析与解决方案\n\n${item.analysis}`,
            sources: []
        });
        setAppState(AppState.SUCCESS);
        setIsLibraryView(true);
    } else {
        // Prepare for new diagnosis
        setAppState(AppState.IDLE);
        setAnalysisResult(null);
        setIsLibraryView(false);
    }
    
    setViewMode('diagnose');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handler to force AI re-analysis even if library item has content
  const handleReAnalyze = () => {
      setIsLibraryView(false);
      handleSubmit();
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-circuit-teal/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-blue-600/10 rounded-full blur-3xl"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-gray-800 bg-slate-900/80 backdrop-blur-md sticky top-0">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-circuit-teal cursor-pointer" onClick={() => { setViewMode('diagnose'); resetApp(); }}>
            <div className="bg-circuit-teal/20 p-2 rounded-lg">
                <IconCpu className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">产品部维修<span className="text-circuit-teal">专家</span></h1>
          </div>
          <div className="flex space-x-1 bg-slate-800 p-1 rounded-lg">
             <button 
                onClick={() => setViewMode('diagnose')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${viewMode === 'diagnose' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
             >
                <IconWrench className="w-4 h-4" />
                智能诊断
             </button>
             <button 
                onClick={() => setViewMode('library')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${viewMode === 'library' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
             >
                <IconList className="w-4 h-4" />
                问题库
             </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow relative z-10 container mx-auto px-4 py-8 max-w-4xl">
        
        {/* === VIEW MODE: DIAGNOSE === */}
        {viewMode === 'diagnose' && (
            <>
                {appState === AppState.IDLE || appState === AppState.ERROR ? (
                    <div className="space-y-8 animate-fade-in">
                        {/* Intro Section */}
                        <div className="text-center space-y-4 mb-12">
                            <h2 className="text-3xl md:text-4xl font-extrabold text-white">
                                您的智能<span className="text-transparent bg-clip-text bg-gradient-to-r from-circuit-teal to-blue-500">电子维修专家</span>
                            </h2>
                            <p className="text-gray-400 max-w-2xl mx-auto text-lg">
                                上传设备故障照片或描述问题，AI 将自动分析电路板损坏情况、检索维修手册，并优先匹配您的自建知识库。
                            </p>
                        </div>

                        {/* Input Card */}
                        <div className="bg-slate-800/50 border border-gray-700 rounded-2xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
                            
                            {/* Text Input */}
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                                    <IconWrench className="w-4 h-4 text-circuit-teal" />
                                    故障描述
                                </label>
                                <textarea 
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full bg-slate-900 border border-gray-700 rounded-xl p-4 text-white focus:ring-2 focus:ring-circuit-teal focus:border-transparent outline-none transition-all placeholder-gray-600 h-32 resize-none"
                                    placeholder="例如：我的洗衣机显示E4错误代码，或者RTX 3070显卡风扇狂转但无显示... 请尽可能详细描述故障现象和设备型号。"
                                />
                            </div>

                            {/* Image Upload Area */}
                            <div className="mb-8">
                                <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                                    <IconCamera className="w-4 h-4 text-circuit-teal" />
                                    上传故障照片（可选，支持多张）
                                </label>
                                
                                <div className="flex flex-wrap gap-3">
                                    {/* Upload Button */}
                                    <div 
                                        onClick={() => imageInputRef.current?.click()}
                                        className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-600 flex flex-col items-center justify-center cursor-pointer hover:border-circuit-teal hover:bg-slate-800 transition-colors text-gray-500 hover:text-circuit-teal"
                                    >
                                        <IconUpload className="w-6 h-6 mb-1" />
                                        <span className="text-xs">添加图片</span>
                                        <input 
                                            type="file" 
                                            ref={imageInputRef} 
                                            accept="image/*" 
                                            multiple 
                                            className="hidden" 
                                            onChange={handleImageSelect}
                                        />
                                    </div>

                                    {/* Image Previews */}
                                    {images.map((img) => (
                                        <div key={img.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-gray-700 group">
                                            <img 
                                                src={`data:${img.mimeType};base64,${img.data}`} 
                                                alt="preview" 
                                                className="w-full h-full object-cover"
                                            />
                                            <button 
                                                onClick={() => removeImage(img.id)}
                                                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                            >
                                                <IconX className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Error Message */}
                            {errorMsg && (
                                <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-xl flex items-start gap-3 text-red-200">
                                    <IconAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                    <span>{errorMsg}</span>
                                </div>
                            )}

                            {/* Submit Button */}
                            <button 
                                onClick={handleSubmit}
                                disabled={!description.trim() && images.length === 0}
                                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] ${
                                    (description.trim() || images.length > 0)
                                    ? 'bg-gradient-to-r from-circuit-teal to-blue-600 text-white shadow-lg shadow-blue-900/50 hover:shadow-blue-900/80 hover:brightness-110' 
                                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                }`}
                            >
                                <IconSearch className="w-5 h-5" />
                                开始AI智能诊断
                            </button>
                        </div>
                    </div>
                ) : null}

                {/* Loading State */}
                {appState === AppState.ANALYZING && (
                    <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
                        <div className="relative w-24 h-24 mb-8">
                            <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-t-circuit-teal border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
                            <div className="absolute inset-4 bg-slate-800 rounded-full flex items-center justify-center animate-pulse-fast">
                                <IconCpu className="w-8 h-8 text-circuit-teal" />
                            </div>
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">正在进行多模态分析...</h3>
                        <p className="text-gray-400 text-center max-w-md">
                            正在对比您的<span className="text-circuit-teal">知识库</span>、扫描图片特征并检索技术文档。
                        </p>
                        <div className="mt-8 flex gap-2">
                            <span className="w-2 h-2 bg-circuit-teal rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                            <span className="w-2 h-2 bg-circuit-teal rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                            <span className="w-2 h-2 bg-circuit-teal rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                        </div>
                    </div>
                )}

                {/* Success / Result State */}
                {appState === AppState.SUCCESS && analysisResult && (
                    <div className="animate-fade-in space-y-6">
                        
                        {/* Result Controls */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                <span className={`p-2 rounded-lg border ${isLibraryView ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
                                    {isLibraryView ? (
                                        <IconFileText className="w-5 h-5" />
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                    )}
                                </span>
                                {isLibraryView ? "知识库存档" : "AI 诊断报告"}
                            </h2>
                            <div className="flex gap-3">
                                {isLibraryView && (
                                    <button 
                                        onClick={handleReAnalyze}
                                        className="px-4 py-2 text-sm bg-slate-700 hover:bg-circuit-teal hover:text-slate-900 text-white rounded-lg transition-colors font-medium flex items-center gap-2"
                                    >
                                        <IconCpu className="w-4 h-4" />
                                        让 AI 重新诊断
                                    </button>
                                )}
                                <button 
                                    onClick={resetApp}
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-transparent hover:border-gray-600 rounded-lg transition-all"
                                >
                                    查询其他问题
                                </button>
                            </div>
                        </div>

                        {/* Main Content Card */}
                        <div className="bg-slate-800 border border-gray-700 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
                            {/* Top decoration line */}
                            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${isLibraryView ? 'from-blue-500 via-purple-500 to-pink-500' : 'from-circuit-teal via-blue-500 to-purple-500'}`}></div>
                            
                            <MarkdownRenderer content={analysisResult.rawText} />

                        </div>

                        {/* References / Grounding Sources (Only show for AI results, not library static content unless specifically added) */}
                        {analysisResult.sources && analysisResult.sources.length > 0 && !isLibraryView && (
                            <div className="bg-slate-900/50 border border-gray-800 rounded-xl p-6">
                                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <IconLink className="w-4 h-4" />
                                    参考资料与来源
                                </h4>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {analysisResult.sources.map((chunk, idx) => (
                                        chunk.web ? (
                                            <a 
                                                key={idx} 
                                                href={chunk.web.uri} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="flex items-start p-3 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors group border border-gray-700 hover:border-gray-500"
                                            >
                                                <div className="flex-grow">
                                                    <div className="text-circuit-teal text-sm font-medium group-hover:underline line-clamp-1">
                                                        {chunk.web.title}
                                                    </div>
                                                    <div className="text-gray-500 text-xs mt-1 truncate">
                                                        {chunk.web.uri}
                                                    </div>
                                                </div>
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 group-hover:text-white ml-2 flex-shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                            </a>
                                        ) : null
                                    ))}
                                </div>
                            </div>
                        )}
                        
                        {/* Disclaimer */}
                        <div className="p-4 bg-orange-900/20 border border-orange-900/50 rounded-xl text-orange-200/80 text-sm flex gap-3">
                            <IconAlert className="w-5 h-5 flex-shrink-0" />
                            <p>
                                免责声明：{isLibraryView ? "本方案来自导入的问题库，仅供参考。" : "本工具提供的维修建议由 AI 生成并仅供参考。"} 电子维修涉及高压电和精密操作，具有危险性。如果您没有相关经验，请寻求专业人士帮助。操作前请务必断开电源。
                            </p>
                        </div>
                    </div>
                )}
            </>
        )}

        {/* === VIEW MODE: LIBRARY === */}
        {viewMode === 'library' && (
            <div className="animate-fade-in space-y-8">
                <div className="text-center space-y-4">
                    <h2 className="text-3xl font-bold text-white">自建问题库</h2>
                    <p className="text-gray-400">导入包含设备名称、故障描述和解决方案的 Excel 清单，构建您的专属知识库</p>
                </div>

                {/* Upload Section */}
                <div className="bg-slate-800/50 border border-gray-700 rounded-2xl p-8 backdrop-blur-sm">
                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Uploader */}
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
                                <IconUpload className="w-4 h-4 text-circuit-teal" />
                                上传知识库文件
                            </label>
                            
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-gray-600 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:border-circuit-teal hover:bg-slate-800/80 transition-all cursor-pointer group h-64"
                            >
                                <div className="bg-slate-700 p-4 rounded-full mb-4 group-hover:bg-circuit-teal/20 transition-colors">
                                    <IconFileText className="w-8 h-8 text-gray-400 group-hover:text-circuit-teal" />
                                </div>
                                <p className="text-white font-medium mb-1">点击选择或拖拽文件</p>
                                <p className="text-gray-500 text-xs">支持 .json, .xlsx, .xls</p>
                                <input 
                                    type="file" 
                                    ref={fileInputRef}
                                    accept=".json, .xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </div>
                            
                            {errorMsg && (
                                <div className="mt-4 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-200 text-sm flex items-center gap-2">
                                    <IconAlert className="w-4 h-4" />
                                    {errorMsg}
                                </div>
                            )}
                        </div>

                        {/* Format Instructions */}
                        <div className="flex-1 bg-slate-900 rounded-xl border border-gray-700 p-6">
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs border border-blue-500/20">必读</span>
                                Excel 模板列名支持
                            </h3>
                            <p className="text-gray-400 text-sm mb-4 leading-relaxed">
                                系统会自动识别以下列名（不区分大小写）：
                            </p>
                            <ul className="text-sm text-gray-300 space-y-2 mb-4">
                                <li className="flex items-start gap-2">
                                    <span className="text-circuit-teal font-mono">设备名称</span>
                                    <span className="text-gray-500">（或：名称, 设备, 标题）</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-circuit-teal font-mono">故障描述</span>
                                    <span className="text-gray-500">（必填。或：描述, 问题, 现象）</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-circuit-teal font-mono">问题分析</span>
                                    <span className="text-gray-500">（可选。或：维修方案, 解决方案, 分析）</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-circuit-teal font-mono">分类</span>
                                    <span className="text-gray-500">（可选。或：类别, category）</span>
                                </li>
                            </ul>
                            
                            <div className="bg-black/50 rounded-lg p-3 font-mono text-[10px] text-gray-400 border border-gray-700 overflow-hidden">
                                <div>JSON 格式示例:</div>
<pre className="text-circuit-teal mt-1">{`[
  {
    "name": "戴尔 G15",
    "description": "不开机，按键无反应",
    "analysis": "检查 EC 芯片供电..."
  }
]`}</pre>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Library List */}
                {libraryItems.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <IconList className="w-5 h-5 text-circuit-teal" />
                                知识库 ({libraryItems.length})
                            </h3>
                            <button 
                                onClick={() => setLibraryItems([])}
                                className="text-xs text-red-400 hover:text-red-300"
                            >
                                清空列表
                            </button>
                        </div>
                        
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {libraryItems.map((item) => (
                                <div key={item.id} className="bg-slate-800 border border-gray-700 rounded-xl p-5 hover:border-circuit-teal/50 transition-colors group flex flex-col justify-between relative overflow-hidden">
                                    {/* Indicator for existing analysis */}
                                    {item.analysis && (
                                        <div className="absolute top-0 right-0 bg-green-500/20 text-green-400 text-[10px] px-2 py-1 rounded-bl-lg border-b border-l border-green-500/20 font-bold">
                                            含方案
                                        </div>
                                    )}
                                    
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 rounded-full bg-slate-700 text-gray-300 text-[10px] uppercase tracking-wider font-bold border border-gray-600">
                                                {item.category}
                                            </span>
                                        </div>
                                        <h4 className="text-white font-semibold text-lg mb-1 truncate" title={item.name}>
                                            {item.name}
                                        </h4>
                                        <p className="text-gray-400 text-sm line-clamp-2 mb-4 h-10">
                                            {item.description}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => selectLibraryItem(item)}
                                        className={`w-full py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                                            item.analysis 
                                            ? 'bg-slate-700 text-green-400 hover:bg-green-500/20' 
                                            : 'bg-slate-700 hover:bg-circuit-teal hover:text-slate-900 text-circuit-teal'
                                        }`}
                                    >
                                        {item.analysis ? (
                                            <>
                                                <IconFileText className="w-3 h-3" />
                                                查看存档方案
                                            </>
                                        ) : (
                                            <>
                                                <IconWrench className="w-3 h-3" />
                                                AI 分析此故障
                                            </>
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-slate-900/50 py-6 mt-8">
        <div className="max-w-4xl mx-auto px-4 text-center text-gray-600 text-sm">
          <p>© {new Date().getFullYear()} 产品部维修专家. Powered by Google Gemini.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;