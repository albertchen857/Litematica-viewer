**简体中文** | [English](./README_EN.md)

# LitematicaViewer投影查看器 v0.7.6+

### Minecraft tool - 让我的世界投影查看更加的轻量便捷

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1H9ZVYtEta/?spm_id_from=333.1387.homepage.video_card.click&vd_source=20c164cb28b2da114329d8728dad750f)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=0nofWrfKJeg)

GITHUB链接: https://github.com/albertchen857/LitematicaViewer
稳定版EXE文件右侧Resource下载
最新(预览)版本PYTHON文件自行克隆 (如果发现问题请多多写写ISSUE谢谢)
求求点点星吧 I want Stars~ target 100 stars

一个轻量便捷的投影查看器

- `导入` 导入投影文件
- `导出` 导出投影数据 (文本&表格)
- `分类导出` 导出分类投影数据 (文本&表格)
- `简洁分析` 轻量分析，只会显示方块名与数量
- `容器分析器` 容器分析，显示容器中存储的方块和基础信息
- `步骤查看器` 渲染投影各层方块,包括其方块和属性
- `生成图形投影` 快捷生成一个常规立方体
- `替换特定方块` 快速替换/限制投影里的不同方块
- `3D渲染` 3D渲染目标投影 (可能引起卡顿)
- `跨版本转换投影` 将默认最新版本投影转换到1.16/1.13版本的投影文件
- `界面颜色` 更改界面主题色 (蔚蓝色,亮绿色,暗灰色,深蓝色,粉色)

# 分支图

```
投影查看器LitematicaViewer
|-分析analysis
| |-简洁分析simpleAnalysis
| |-容器分析ContainerAnalysis
| | |-普通分析Norm
| | |-分类分析(开发ing)Cate
| |-全面分析 (关闭)FullAnalysis
|-导出Output
| |-普通导出 (txt/csv)Norm
| |-分类导出 (txt/csv)Cate
|-统计Stat
| |-常规统计 (红石/中位/其他)Basic
| |-成分统计 (方块拼图)PieGraph
|-功能func
| |-3D渲染 (旋转/静止)3DRender
| |-步骤查看器StepChecker
| |-生成图形投影Polygon
| | |-立方体生成Cube
| | |-特殊形状生成(开发)Unusual
| |-替换特定方块ChangeIndentifyBlock
| |-投影转换版本 (1.17/1.15/1.12)TransVersion
|-界面UI
  |-字体/颜色/布局自定义美化 UIupdate (V0.7)
```

## Star History

<a href="https://www.star-history.com/?repos=albertchen857%2FLitematica-viewer&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
 </picture>
</a>
