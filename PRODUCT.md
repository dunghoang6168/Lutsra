# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Angular 21, Electron (Desktop for Windows)

## Users

Audiophile quản lý thư viện file cục bộ.

## Product Purpose

Lutstra là một ứng dụng desktop nghe nhạc local-first, tập trung vào chất lượng file (lossless, hi-res) và quản lý thư viện nhạc cục bộ.

## Positioning

Trình phát nhạc dành cho người dùng yêu cầu cao về chất lượng âm thanh và muốn toàn quyền quản lý kho nhạc offline của mình.

## Capabilities and Constraints

- Đã có sẵn 3 theme: sáng, tối và liquid-glass.
- Sử dụng SCSS tokens có sẵn cho spacing, radius, và màu sắc (không hard-code).
- Ứng dụng dùng Angular signals và control flow (`@if`/`@for`).
- UI cần đảm bảo accessibility (ARIA, phím tắt, thứ tự focus).
- Không thay đổi hành vi phát nhạc, gateway hay IPC của Electron; chỉ điều chỉnh tầng UI.
- Không thêm dependency mới.

## Brand Commitments

- Tông thiết kế: Audiophile tinh tế.
- Trọng tâm hiển thị: Chất lượng file (lossless, hi-res, số file bị mất).
- Ít màu sắc, màu chỉ đi theo accent người dùng chọn. Chữ và ảnh bìa là yếu tố dẫn dắt.
