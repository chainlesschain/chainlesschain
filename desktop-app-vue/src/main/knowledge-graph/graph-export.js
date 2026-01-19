/**
 * 知识图谱导出模块
 * 支持多种格式导出：PNG, SVG, JSON, GraphML, GEXF, DOT
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

// Mock dialog for testing
let dialog, app;
try {
  const electron = require('electron');
  dialog = electron.dialog;
  app = electron.app;
} catch (e) {
  // Mock for testing without Electron
  dialog = {
    showSaveDialog: async (options) => ({
      canceled: false,
      filePath: path.join(require('os').tmpdir(), options.defaultPath || 'export.json')
    })
  };
  app = {
    getPath: (name) => require('os').tmpdir()
  };
}

/**
 * 导出为 JSON 格式
 */
function exportToJSON(nodes, edges) {
  return JSON.stringify({
    nodes: nodes.map(node => ({
      id: node.id,
      title: node.title,
      type: node.type,
      created_at: node.created_at,
      updated_at: node.updated_at,
    })),
    edges: edges.map(edge => ({
      source: edge.source_id,
      target: edge.target_id,
      type: edge.relation_type,
      weight: edge.weight,
    })),
  }, null, 2);
}

/**
 * 导出为 GraphML 格式（Gephi 兼容）
 */
function exportToGraphML(nodes, edges) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n';
  xml += '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  xml += '         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns\n';
  xml += '         http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n';

  // 定义属性
  xml += '  <key id="d0" for="node" attr.name="title" attr.type="string"/>\n';
  xml += '  <key id="d1" for="node" attr.name="type" attr.type="string"/>\n';
  xml += '  <key id="d2" for="edge" attr.name="type" attr.type="string"/>\n';
  xml += '  <key id="d3" for="edge" attr.name="weight" attr.type="double"/>\n';

  xml += '  <graph id="G" edgedefault="directed">\n';

  // 添加节点
  nodes.forEach(node => {
    xml += `    <node id="${escapeXml(node.id)}">\n`;
    xml += `      <data key="d0">${escapeXml(node.title || '')}</data>\n`;
    xml += `      <data key="d1">${escapeXml(node.type || '')}</data>\n`;
    xml += `    </node>\n`;
  });

  // 添加边
  edges.forEach((edge, index) => {
    xml += `    <edge id="e${index}" source="${escapeXml(edge.source_id)}" target="${escapeXml(edge.target_id)}">\n`;
    xml += `      <data key="d2">${escapeXml(edge.relation_type || '')}</data>\n`;
    xml += `      <data key="d3">${edge.weight || 1.0}</data>\n`;
    xml += `    </edge>\n`;
  });

  xml += '  </graph>\n';
  xml += '</graphml>\n';

  return xml;
}

/**
 * 导出为 GEXF 格式（Gephi 原生格式）
 */
function exportToGEXF(nodes, edges) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">\n';
  xml += '  <meta lastmodifieddate="' + new Date().toISOString().split('T')[0] + '">\n';
  xml += '    <creator>ChainlessChain Knowledge Graph</creator>\n';
  xml += '    <description>Knowledge Graph Export</description>\n';
  xml += '  </meta>\n';

  xml += '  <graph mode="static" defaultedgetype="directed">\n';

  // 定义属性
  xml += '    <attributes class="node">\n';
  xml += '      <attribute id="0" title="title" type="string"/>\n';
  xml += '      <attribute id="1" title="type" type="string"/>\n';
  xml += '    </attributes>\n';

  xml += '    <attributes class="edge">\n';
  xml += '      <attribute id="0" title="type" type="string"/>\n';
  xml += '      <attribute id="1" title="weight" type="double"/>\n';
  xml += '    </attributes>\n';

  // 添加节点
  xml += '    <nodes>\n';
  nodes.forEach(node => {
    xml += `      <node id="${escapeXml(node.id)}" label="${escapeXml(node.title || '')}">\n`;
    xml += '        <attvalues>\n';
    xml += `          <attvalue for="0" value="${escapeXml(node.title || '')}"/>\n`;
    xml += `          <attvalue for="1" value="${escapeXml(node.type || '')}"/>\n`;
    xml += '        </attvalues>\n';
    xml += '      </node>\n';
  });
  xml += '    </nodes>\n';

  // 添加边
  xml += '    <edges>\n';
  edges.forEach((edge, index) => {
    xml += `      <edge id="${index}" source="${escapeXml(edge.source_id)}" target="${escapeXml(edge.target_id)}">\n`;
    xml += '        <attvalues>\n';
    xml += `          <attvalue for="0" value="${escapeXml(edge.relation_type || '')}"/>\n`;
    xml += `          <attvalue for="1" value="${edge.weight || 1.0}"/>\n`;
    xml += '        </attvalues>\n';
    xml += '      </edge>\n';
  });
  xml += '    </edges>\n';

  xml += '  </graph>\n';
  xml += '</gexf>\n';

  return xml;
}

/**
 * 导出为 DOT 格式（Graphviz）
 */
function exportToDOT(nodes, edges) {
  let dot = 'digraph KnowledgeGraph {\n';
  dot += '  node [shape=box, style=rounded];\n';
  dot += '  edge [dir=forward];\n\n';

  // 添加节点
  nodes.forEach(node => {
    const label = escapeDot(node.title || node.id);
    const type = node.type || 'note';
    dot += `  "${escapeDot(node.id)}" [label="${label}", type="${type}"];\n`;
  });

  dot += '\n';

  // 添加边
  edges.forEach(edge => {
    const type = edge.relation_type || 'link';
    const weight = edge.weight || 1.0;
    dot += `  "${escapeDot(edge.source_id)}" -> "${escapeDot(edge.target_id)}" [label="${type}", weight=${weight}];\n`;
  });

  dot += '}\n';

  return dot;
}

/**
 * 导出为 CSV 格式（节点和边分别导出）
 */
function exportToCSV(nodes, edges) {
  // 节点 CSV
  let nodesCsv = 'id,title,type,created_at,updated_at\n';
  nodes.forEach(node => {
    nodesCsv += `"${escapeCsv(node.id)}","${escapeCsv(node.title || '')}","${escapeCsv(node.type || '')}","${node.created_at || ''}","${node.updated_at || ''}"\n`;
  });

  // 边 CSV
  let edgesCsv = 'source,target,type,weight\n';
  edges.forEach(edge => {
    edgesCsv += `"${escapeCsv(edge.source_id)}","${escapeCsv(edge.target_id)}","${escapeCsv(edge.relation_type || '')}",${edge.weight || 1.0}\n`;
  });

  return {
    nodes: nodesCsv,
    edges: edgesCsv,
  };
}

/**
 * 导出为交互式 HTML
 */
function exportToHTML(nodes, edges) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>知识图谱 - ChainlessChain</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
    #container {
      width: 100vw;
      height: 100vh;
    }
    .info {
      position: absolute;
      top: 20px;
      left: 20px;
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      z-index: 1000;
    }
    .info h2 {
      margin: 0 0 10px 0;
      font-size: 18px;
    }
    .info p {
      margin: 5px 0;
      font-size: 14px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="info">
    <h2>知识图谱</h2>
    <p>节点数: ${nodes.length}</p>
    <p>关系数: ${edges.length}</p>
    <p>可拖拽、缩放、点击节点查看详情</p>
  </div>
  <div id="container"></div>

  <script>
    const nodes = ${JSON.stringify(nodes.map(n => ({
      id: n.id,
      name: n.title,
      title: n.title,
      type: n.type,
      symbolSize: 30,
      itemStyle: {
        color: n.type === 'note' ? '#5470c6' : n.type === 'document' ? '#91cc75' : '#fac858'
      }
    })))};

    const edges = ${JSON.stringify(edges.map(e => ({
      source: e.source_id,
      target: e.target_id,
      type: e.relation_type,
      lineStyle: {
        width: Math.max(1, (e.weight || 1) * 2),
        color: e.relation_type === 'link' ? '#5470c6' : e.relation_type === 'tag' ? '#91cc75' : '#fac858'
      }
    })))};

    const chart = echarts.init(document.getElementById('container'));

    const option = {
      tooltip: {
        trigger: 'item',
        formatter: function(params) {
          if (params.dataType === 'node') {
            return '<strong>' + params.data.title + '</strong><br/>类型: ' + params.data.type;
          } else if (params.dataType === 'edge') {
            return params.data.source + ' → ' + params.data.target + '<br/>类型: ' + params.data.type;
          }
        }
      },
      series: [{
        type: 'graph',
        layout: 'force',
        data: nodes,
        links: edges,
        roam: true,
        label: {
          show: true,
          position: 'right',
          formatter: '{b}'
        },
        labelLayout: {
          hideOverlap: true
        },
        emphasis: {
          focus: 'adjacency',
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold'
          }
        },
        force: {
          repulsion: 300,
          edgeLength: 150,
          gravity: 0.1
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, 8]
      }]
    };

    chart.setOption(option);

    window.addEventListener('resize', function() {
      chart.resize();
    });
  </script>
</body>
</html>`;

  return html;
}

/**
 * 保存导出文件
 */
async function saveExportFile(content, format, defaultName = 'knowledge-graph') {
  const extensions = {
    json: 'json',
    graphml: 'graphml',
    gexf: 'gexf',
    dot: 'dot',
    csv: 'csv',
    html: 'html',
  };

  const filters = {
    json: [{ name: 'JSON Files', extensions: ['json'] }],
    graphml: [{ name: 'GraphML Files', extensions: ['graphml'] }],
    gexf: [{ name: 'GEXF Files', extensions: ['gexf'] }],
    dot: [{ name: 'DOT Files', extensions: ['dot'] }],
    csv: [{ name: 'CSV Files', extensions: ['csv'] }],
    html: [{ name: 'HTML Files', extensions: ['html'] }],
  };

  try {
    const result = await dialog.showSaveDialog({
      title: '导出知识图谱',
      defaultPath: path.join(app.getPath('documents'), `${defaultName}.${extensions[format]}`),
      filters: filters[format] || [{ name: 'All Files', extensions: ['*'] }],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    // CSV 格式需要保存两个文件
    if (format === 'csv' && typeof content === 'object') {
      const basePath = result.filePath.replace(/\.csv$/, '');
      fs.writeFileSync(`${basePath}_nodes.csv`, content.nodes, 'utf8');
      fs.writeFileSync(`${basePath}_edges.csv`, content.edges, 'utf8');
      return {
        path: basePath,
        files: [`${basePath}_nodes.csv`, `${basePath}_edges.csv`],
      };
    }

    fs.writeFileSync(result.filePath, content, 'utf8');

    return {
      path: result.filePath,
    };
  } catch (error) {
    logger.error('[Export] 保存文件失败:', error);
    throw error;
  }
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 转义 DOT 特殊字符
 */
function escapeDot(str) {
  if (!str) {return '';}
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * 转义 CSV 特殊字符
 */
function escapeCsv(str) {
  if (!str) {return '';}
  return String(str).replace(/"/g, '""');
}

/**
 * 导出图谱（主函数）
 */
async function exportGraph(nodes, edges, format) {
  let content;

  switch (format) {
    case 'json':
      content = exportToJSON(nodes, edges);
      break;
    case 'graphml':
      content = exportToGraphML(nodes, edges);
      break;
    case 'gexf':
      content = exportToGEXF(nodes, edges);
      break;
    case 'dot':
      content = exportToDOT(nodes, edges);
      break;
    case 'csv':
      content = exportToCSV(nodes, edges);
      break;
    case 'html':
      content = exportToHTML(nodes, edges);
      break;
    default:
      throw new Error(`不支持的导出格式: ${format}`);
  }

  return await saveExportFile(content, format);
}

module.exports = {
  exportGraph,
  exportToJSON,
  exportToGraphML,
  exportToGEXF,
  exportToDOT,
  exportToCSV,
  exportToHTML,
};
