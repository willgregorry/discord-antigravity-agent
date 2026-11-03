const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORED = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'bin',
  'temp_downloads',
  '.venv',
  'venv',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb'
]);

class TreeService {
  /**
   * Generates a directory tree structure
   * @param {string} rootDir - Root directory to scan
   * @param {number} maxDepth - Max recursion depth (default: 4)
   * @param {Set<string>} customIgnored - Extra folders to ignore
   * @returns {{ treeString: string, stats: { totalDirs: number, totalFiles: number }, isTruncated: boolean }}
   */
  static generateTree(rootDir, maxDepth = 4, customIgnored = new Set()) {
    const ignored = new Set([...DEFAULT_IGNORED, ...customIgnored]);
    const stats = { totalDirs: 0, totalFiles: 0 };
    let isTruncated = false;

    function buildBranch(dir, currentDepth, prefix = '') {
      if (currentDepth > maxDepth) {
        return [];
      }

      let items = [];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch (err) {
        return [`${prefix}└── [Akses Ditolak: ${err.message}]`];
      }

      // Filter ignored
      items = items.filter(item => !ignored.has(item.name) && !item.name.startsWith('.'));

      // Sort: directories first, then files alphabetically
      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      // Limit items per directory to 50 to avoid infinite loops on gigantic folders
      if (items.length > 50) {
        isTruncated = true;
        items = items.slice(0, 50);
      }

      const lines = [];
      items.forEach((item, index) => {
        const isLast = index === items.length - 1;
        const pointer = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');

        if (item.isDirectory()) {
          stats.totalDirs++;
          lines.push(`${prefix}${pointer}📁 ${item.name}/`);
          const subLines = buildBranch(path.join(dir, item.name), currentDepth + 1, childPrefix);
          lines.push(...subLines);
        } else {
          stats.totalFiles++;
          const ext = path.extname(item.name).toLowerCase();
          let icon = '📄';
          if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) icon = '📜';
          else if (['.json', '.yaml', '.yml', '.toml', '.env'].includes(ext)) icon = '⚙️';
          else if (['.css', '.scss', '.sass', '.less'].includes(ext)) icon = '🎨';
          else if (['.png', '.jpg', '.jpeg', '.svg', '.gif', '.ico', '.webp'].includes(ext)) icon = '🖼️';
          else if (['.md', '.txt', '.pdf', '.docx', '.csv'].includes(ext)) icon = '📝';
          else if (['.html', '.ejs'].includes(ext)) icon = '🌐';
          else if (['.bat', '.sh', '.ps1', '.vbs', '.cmd'].includes(ext)) icon = '⚡';

          lines.push(`${prefix}${pointer}${icon} ${item.name}`);
        }
      });

      return lines;
    }

    const baseName = path.basename(rootDir) || rootDir;
    const treeLines = [`📁 ${baseName}/`, ...buildBranch(rootDir, 1)];

    return {
      treeString: treeLines.join('\n'),
      stats,
      isTruncated
    };
  }
}

module.exports = { TreeService };
