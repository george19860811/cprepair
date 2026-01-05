import { GoogleGenAI } from "@google/genai";
import { RepairAnalysis } from "../types";

const SYSTEM_INSTRUCTION = `
你是一位专业的“产品部维修专家”，拥有深厚的电子工程和维修经验。
你的核心任务是根据用户提供的故障描述（文字或图片），输出一份详尽、专业的维修方案。

**核心工作流**：
1. **优先检索自建知识库**：参考上下文中的历史案例。
2. **多模态综合分析**：扫描图片视觉信息和文字描述进行诊断。
3. **联网搜索（Grounding）**：使用 'googleSearch' 工具检索官方维修手册或原理图。

输出语言：简体中文。语气：严谨、专业。
`;

async function generateWithRetry(modelName: string, params: any, retries = 3, initialDelay = 2000) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING");
  }

  const ai = new GoogleGenAI({ apiKey });
  let delay = initialDelay;

  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        ...params
      });
    } catch (error: any) {
      const errorMessage = error.message || "";
      // 捕获常见的授权/权限错误
      if (errorMessage.includes("Requested entity was not found") || 
          errorMessage.includes("API key not valid") || 
          error.status === 403 || 
          error.status === 401) {
        throw new Error("API_KEY_INVALID");
      }

      const isNetworkError = errorMessage.includes("500") || 
                            errorMessage.includes("fetch") || 
                            errorMessage.includes("Rpc failed") ||
                            errorMessage.includes("XHR error");

      if (isNetworkError && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw new Error("MAX_RETRIES_REACHED");
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
  textPrompt += `请作为产品部维修专家输出最终方案。`;
  parts.push({ text: textPrompt });

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

  const text = response.text || "诊断引擎未返回有效文本。";
  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const groundingChunks = rawChunks.map(chunk => (chunk.web ? { web: { uri: chunk.web.uri, title: chunk.web.title } } : {}));

  return {
    diagnosis: "Analysis Complete",
    rawText: text,
    sources: groundingChunks,
  };
};
