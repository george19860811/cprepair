import { GoogleGenAI } from "@google/genai";
import { RepairAnalysis } from "../types";

const SYSTEM_INSTRUCTION = `
你是一位专业的“产品部维修专家”，拥有深厚的电子工程和维修经验。
你的核心任务是根据用户提供的故障描述（文字或图片），输出一份详尽、专业的维修方案。

**核心工作流（必须严格执行）**：
1. **优先检索自建知识库**：
   - 检查用户提供的“自建维修知识库”上下文。
   - 如果发现设备型号、故障现象与知识库中的条目匹配或高度相似，**必须**优先采用该条目中的“问题分析”和“存档方案”。
   - 在报告开头明确指出：“📚 匹配到知识库历史案例：[设备名]”。
2. **多模态综合分析**：扫描图片视觉信息和文字描述进行诊断。
3. **联网搜索（Grounding）**：使用 'googleSearch' 工具检索该型号设备的官方维修手册或原理图。

输出语言：简体中文。语气：严谨、专业。
`;

async function generateWithRetry(modelName: string, params: any, retries = 3, initialDelay = 2000) {
  // 关键修复：每次请求前重新实例化，确保获取最新的 process.env.API_KEY
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  let delay = initialDelay;
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        ...params
      });
    } catch (error: any) {
      const errorMessage = error.message || "";
      // 如果报错实体未找到，通常意味着 API Key 无效或项目未开启相应权限
      if (errorMessage.includes("Requested entity was not found")) {
        throw new Error("API_KEY_INVALID");
      }

      const isNetworkError = errorMessage.includes("500") || errorMessage.includes("fetch") || errorMessage.includes("Rpc failed");
      if (isNetworkError && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries reached");
}

export const analyzeRepairIssue = async (
  description: string,
  images?: { data: string; mimeType: string }[],
  knowledgeBase?: string
): Promise<RepairAnalysis> => {
  const parts: any[] = [];

  if (images && images.length > 0) {
      images.forEach(img => {
          parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
      });
  }

  let textPrompt = `【当前故障上报】\n描述：${description}\n\n`;
  if (knowledgeBase) {
      textPrompt += `【待查阅：自建维修知识库上下文】\n${knowledgeBase}\n\n`;
  }
  textPrompt += `请作为产品部维修专家输出方案。`;
  parts.push({ text: textPrompt });

  try {
    const response = await generateWithRetry(
      "gemini-3-pro-preview", 
      {
        contents: { parts: parts },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
        },
      }
    );

    const text = response.text || "无法生成分析结果。";
    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingChunks = rawChunks.map(chunk => (chunk.web ? { web: { uri: chunk.web.uri, title: chunk.web.title } } : {}));

    return {
      diagnosis: "Analysis Complete",
      rawText: text,
      sources: groundingChunks,
    };
  } catch (error: any) {
    if (error.message === "API_KEY_INVALID") throw error;
    throw new Error("诊断过程中发生错误，请重试。");
  }
};