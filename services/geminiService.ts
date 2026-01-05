import { GoogleGenAI } from "@google/genai";
import { RepairAnalysis } from "../types";

const SYSTEM_INSTRUCTION = `
你是一位专业的电子维修助手。
你的任务是根据用户提供的故障描述（文字或图片），输出一份详尽、专业的维修建议。

**工作流**：
1. **参考知识库**：如果提供了自建案例库上下文，请优先寻找匹配项。
2. **综合分析**：结合图片视觉信息和文字描述进行诊断。
3. **联网搜索**：使用 'googleSearch' 工具检索该设备的相关技术参数或常见故障点。

输出要求：简体中文，步骤清晰，安全第一。
`;

async function generateWithRetry(modelName: string, params: any, retries = 3, initialDelay = 2000) {
  // 直接从环境变量获取 API Key，不再在服务层抛出缺失异常，交由 SDK 处理
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  let delay = initialDelay;

  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        ...params
      });
    } catch (error: any) {
      const errorMessage = error.message || "";
      
      // 捕获常见的网络或配额错误进行重试
      const isRetryable = errorMessage.includes("500") || 
                         errorMessage.includes("fetch") || 
                         errorMessage.includes("Rpc failed") ||
                         errorMessage.includes("XHR error");

      if (isRetryable && i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw new Error("诊断请求超时或失败，请稍后重试。");
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

  let textPrompt = `【故障上报】\n描述：${description}\n\n`;
  if (knowledgeBase) {
    textPrompt += `【参考知识库】\n${knowledgeBase}\n\n`;
  }
  textPrompt += `请给出维修方案。`;
  parts.push({ text: textPrompt });

  // 切换为 gemini-3-flash-preview
  const response = await generateWithRetry(
    "gemini-3-flash-preview", 
    {
      contents: { parts: parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
      },
    }
  );

  const text = response.text || "未能生成诊断结果。";
  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const groundingChunks = rawChunks.map(chunk => (chunk.web ? { web: { uri: chunk.web.uri, title: chunk.web.title } } : {}));

  return {
    diagnosis: "Analysis Complete",
    rawText: text,
    sources: groundingChunks,
  };
};
