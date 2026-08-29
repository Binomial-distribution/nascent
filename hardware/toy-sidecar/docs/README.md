# toy-sidecar 验证期 BOM 与原理图

给硬件赛道评审用的两份材料，口径与 [`../README.md`](../README.md)、[`include/config.h`](../include/config.h) 一致。

| 文件 | 给评审表贴的链接类型 |
|---|---|
| [`bom.md`](bom.md) | BOM 表（GitHub 渲染） |
| [`bom.csv`](bom.csv) | 同一份表的机器可读副本 |
| [`schematic.png`](schematic.png) | 接线原理图（图片，评审表优先贴这个） |
| [`schematic.svg`](schematic.svg) | 同一张图的矢量版 |
| [`bom-and-schematic.pdf`](bom-and-schematic.pdf) | BOM + 原理图合订 PDF |

评审表「BOM 表 / 原理图链接」每行一个 URL，合并进 `main` 后用：

```
https://github.com/Binomial-distribution/nascent/blob/main/hardware/toy-sidecar/docs/bom.md
https://raw.githubusercontent.com/Binomial-distribution/nascent/main/hardware/toy-sidecar/docs/schematic.png
https://raw.githubusercontent.com/Binomial-distribution/nascent/main/hardware/toy-sidecar/docs/bom-and-schematic.pdf
```

合并前把 `main` 换成当前分支名。

硬边界写在原理图标题栏里：**本板不驱动电机**；漏极 10kΩ（R3）把按键支路封在 0.37mA。
