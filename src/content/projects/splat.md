---
title: splat
date: 2024-07-17
tags: [rust, wgpu, wgsl, image processing, optimization]
repository: https://github.com/matteopolak/splat
---

A GPU-driven image optimizer that approximates a target with blurry ellipses, iteratively perturbs splat parameters, renders candidates, measures pixel error, and rolls back regressions until reaching a configured threshold.
