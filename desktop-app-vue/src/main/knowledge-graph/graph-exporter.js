/**
 * 知识图谱导出工具
 *
 * 支持多种格式导出：SVG, PNG, GraphML, GEXF, JSON
 */

const fs = require('fs');
const path = require('path');

class GraphExporter {
  constructor() {
    this.graph = null;
  }

  /**
   * 加载图数据
   */
  loadGraph(nodes, edges) {
    this.graph = { nodes, edges };
  }

  /**
   * 导出为GraphML格式
   * GraphML是标准的图数据交换格式
   */
  exportToGraphML() {
    const { nodes, edges } = this.graph;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n';
    xml += '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns\n';
    xml += '         http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n';

    // 定义属性
    xml += '  <key id="d0" for="node" attr.name="label" attr.type="string"/>\n';
    xml += '  <key id="d1" for="node" attr.name="type" attr.type="string"/>\n';
    xml += '  <key id="d2" for="edge" attr.name="weight" attr.type="double"/>\n';
    xml += '  <key id="d3" for="edge" attr.name="relationType" attr.type="string"/>\n';

    xml += '  <graph id="G" edgedefault="undirected">\n';

    // 添加节点
    nodes.forEach(node => {
      xml += `    <node id="${this.escapeXml(node.id)}">\n`;
      xml += `      <data key="d0">${this.escapeXml(node.name || node.id)}</data>\n`;
      xml += `      <data key="d1">${this.escapeXml(node.type || 'note')}</data>\n`;
      xml += '    </node>\n';
    });

    // 添加边
    edges.forEach((edge, index) => {
      xml += `    <edge id="e${index}" source="${this.escapeXml(edge.source)}" target="${this.escapeXml(edge.target)}">\n`;
      xml += `      <data key="d2">${edge.weight || 1.0}</data>\n`;
      xml += `      <data key="d3">${this.escapeXml(edge.relationType || 'link')}</data>\n`;
      xml += '    </edge>\n';
    });

    xml += '  </graph>\n';
    xml += '</graphml>';

    return xml;
  }

  /**
   * 导出为GEXF格式
   * GEXF是Gephi使用的图格式
   */
  exportToGEXF() {
    const { nodes, edges } = this.graph;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">\n';
    xml += '  <meta lastmodifieddate="' + new Date().toISOString() + '">\n';
    xml += '    <creator>ChainlessChain</creator>\n';
    xml += '    <description>Knowledge Graph Export</description>\n';
    xml += '  </meta>\n';
    xml += '  <graph mode="static" defaultedgetype="undirected">\n';

    // 节点属性定义
    xml += '    <attributes class="node">\n';
    xml += '      <attribute id="0" title="type" type="string"/>\n';
    xml += '    </attributes>\n';

    // 边属性定义
    xml += '    <attributes class="edge">\n';
    xml += '      <attribute id="0" title="relationType" type="string"/>\n';
    xml += '    </attributes>\n';

    // 添加节点
    xml += '    <nodes>\n';
    nodes.forEach(node => {
      xml += `      <node id="${this.escapeXml(node.id)}" label="${this.escapeXml(node.name || node.id)}">\n`;
      xml += '        <attvalues>\n';
      xml += `          <attvalue for="0" value="${this.escapeXml(node.type || 'note')}"/>\n`;
      xml += '        </attvalues>\n';
      xml += '      </node>\n';
    });
    xml += '    </nodes>\n';

    // 添加边
    xml += '    <edges>\n';
    edges.forEach((edge, index) => {
      xml += `      <edge id="${index}" source="${this.escapeXml(edge.source)}" target="${this.escapeXml(edge.target)}" weight="${edge.weight || 1.0}">\n`;
      xml += '        <attvalues>\n';
      xml += `          <attvalue for="0" value="${this.escapeXml(edge.relationType || 'link')}"/>\n`;
      xml += '        </attvalues>\n';
      xml += '      </edge>\n';
    });
    xml += '    </edges>\n';

    xml += '  </graph>\n';
    xml += '</gexf>';

    return xml;
  }

  /**
   * 导出为JSON格式
   */
  exportToJSON() {
    return JSON.stringify(this.graph, null, 2);
  }

  /**
   * 导出为CSV格式（边列表）
   */
  exportToCSV() {
    const { edges } = this.graph;

    let csv = 'Source,Target,Weight,RelationType\n';

    edges.forEach(edge => {
      csv += `"${edge.source}","${edge.target}",${edge.weight || 1.0},"${edge.relationType || 'link'}"\n`;
    });

    return csv;
  }

  /**
   * 导出为DOT格式（Graphviz）
   */
  exportToDOT() {
    const { nodes, edges } = this.graph;

    let dot = 'graph KnowledgeGraph {\n';
    dot += '  layout=fdp;\n';
    dot += '  overlap=false;\n';
    dot += '  splines=true;\n\n';

    // 添加节点
    nodes.forEach(node => {
      const label = this.escapeDOT(node.name || node.id);
      const type = node.type || 'note';
      const color = this.getNodeColor(type);

      dot += `  "${node.id}" [label="${label}", shape=box, style=filled, fillcolor="${color}"];\n`;
    });

    dot += '\n';

    // 添加边
    edges.forEach(edge => {
      const weight = edge.weight || 1.0;
      const type = edge.relationType || 'link';
      const color = this.getEdgeColor(type);

      dot += `  "${edge.source}" -- "${edge.target}" [weight=${weight}, color="${color}", label="${type}"];\n`;
    });

    dot += '}';

    return dot;
  }

  /**
   * 导出为Cytoscape.js格式
   */
  exportToCytoscape() {
    const { nodes, edges } = this.graph;

    const elements = {
      nodes: nodes.map(node => ({
        data: {
          id: node.id,
          label: node.name || node.id,
          type: node.type || 'note'
        }
      })),
      edges: edges.map((edge, index) => ({
        data: {
          id: `e${index}`,
          source: edge.source,
          target: edge.target,
          weight: edge.weight || 1.0,
          relationType: edge.relationType || 'link'
        }
      }))
    };

    return JSON.stringify(elements, null, 2);
  }

  /**
   * 保存到文件
   */
  async saveToFile(filePath, format = 'graphml') {
    let content;

    switch (format.toLowerCase()) {
      case 'graphml':
        content = this.exportToGraphML();
        break;
      case 'gexf':
        content = this.exportToGEXF();
        break;
      case 'json':
        content = this.exportToJSON();
        break;
      case 'csv':
        content = this.exportToCSV();
        break;
      case 'dot':
        content = this.exportToDOT();
        break;
      case 'cytoscape':
        content = this.exportToCytoscape();
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * 导出图像（需要在渲染进程中调用）
   */
  async exportImage(canvas, format = 'png', quality = 0.95) {
    return new Promise((resolve, reject) => {
      try {
        const dataUrl = canvas.toDataURL(`image/${format}`, quality);
        resolve(dataUrl);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 导出SVG（从ECharts实例）
   */
  exportSVG(chartInstance) {
    const svg = chartInstance.renderToSVGString();
    return svg;
  }

  /**
   * 辅助方法：转义XML
   */
  escapeXml(str) {
    if (typeof str !== 'string') return str;

    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 辅助方法：转义DOT
   */
  escapeDOT(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/"/g, '\\"');
  }

  /**
   * 辅助方法：获取节点颜色
   */
  getNodeColor(type) {
    const colors = {
      note: '#5470c6',
      tag: '#91cc75',
      project: '#fac858',
      person: '#ee6666',
      default: '#73c0de'
    };

    return colors[type] || colors.default;
  }

  /**
   * 辅助方法：获取边颜色
   */
  getEdgeColor(type) {
    const colors = {
      link: '#5470c6',
      tag: '#91cc75',
      semantic: '#fac858',
      temporal: '#ee6666',
      default: '#999999'
    };

    return colors[type] || colors.default;
  }

  /**
   * 获取支持的格式列表
   */
  static getSupportedFormats() {
    return [
      { value: 'graphml', label: 'GraphML (.graphml)', description: '标准图数据交换格式' },
      { value: 'gexf', label: 'GEXF (.gexf)', description: 'Gephi图格式' },
      { value: 'json', label: 'JSON (.json)', description: 'JSON数据格式' },
      { value: 'csv', label: 'CSV (.csv)', description: '边列表CSV格式' },
      { value: 'dot', label: 'DOT (.dot)', description: 'Graphviz格式' },
      { value: 'cytoscape', label: 'Cytoscape.js (.json)', description: 'Cytoscape.js格式' },
      { value: 'png', label: 'PNG图像 (.png)', description: 'PNG图像格式' },
      { value: 'svg', label: 'SVG矢量图 (.svg)', description: 'SVG矢量图格式' }
    ];
  }
}

module.exports = GraphExporter;
