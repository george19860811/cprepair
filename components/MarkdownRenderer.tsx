import React from 'react';

interface Props {
  content: string;
}

// Simple regex-based markdown parser for specific needs of this app
// Used to avoid large dependencies in this environment
const MarkdownRenderer: React.FC<Props> = ({ content }) => {
  const lines = content.split('\n');

  return (
    <div className="space-y-4 text-gray-200 leading-relaxed">
      {lines.map((line, index) => {
        // Headers
        if (line.startsWith('## ')) {
          return <h2 key={index} className="text-xl font-bold text-circuit-teal mt-6 mb-2 border-b border-gray-700 pb-2">{line.replace('## ', '')}</h2>;
        }
        if (line.startsWith('### ')) {
          return <h3 key={index} className="text-lg font-semibold text-blue-400 mt-4 mb-1">{line.replace('### ', '')}</h3>;
        }
        if (line.startsWith('* **') || line.startsWith('- **')) {
           // List items with bold start
           const cleanLine = line.replace(/^\* \*\*/, '').replace(/^- \*\*/, '');
           const parts = cleanLine.split('**:');
           if (parts.length > 1) {
             return (
               <li key={index} className="ml-4 list-disc marker:text-circuit-teal">
                 <span className="font-bold text-white">{parts[0]}:</span>
                 <span>{parts.slice(1).join('**:')}</span>
               </li>
             );
           }
        }
        
        // Bullet points
        if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
          return <li key={index} className="ml-4 list-disc marker:text-gray-500">{line.replace(/^[\*\-] /, '')}</li>;
        }

        // Bold processing for normal paragraphs
        const parts = line.split(/(\*\*.*?\*\*)/g);
        
        if (line.trim() === '') return <br key={index} />;

        return (
          <p key={index} className="">
            {parts.map((part, i) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
              }
              return part;
            })}
          </p>
        );
      })}
    </div>
  );
};

export default MarkdownRenderer;
