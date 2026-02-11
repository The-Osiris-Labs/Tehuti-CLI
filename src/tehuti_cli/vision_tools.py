"""
Tehuti Vision Tools - Image Analysis and Computer Vision

Provides tools for:
- Image analysis and description
- OCR (Optical Character Recognition)
- Image manipulation
- Screenshot capture
- Visual QA
"""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from tehuti_cli.storage.config import Config
from tehuti_cli.advanced_tools import ToolResult


class VisionTools:
    """Vision and image analysis tools."""

    def __init__(self, config: Config, work_dir: Path):
        self.config = config
        self.work_dir = work_dir.resolve()

    def _encode_image(self, image_path: str | Path) -> str | None:
        """Encode image to base64 for LLM analysis."""
        try:
            path = Path(image_path)
            if not path.exists():
                return None
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        except Exception:
            return None

    def _get_image_size(self, image_path: str | Path) -> dict[str, int] | None:
        """Get image dimensions."""
        try:
            from PIL import Image

            path = Path(image_path)
            if not path.exists():
                return None
            with Image.open(path) as img:
                return {"width": img.size[0], "height": img.size[1]}
        except Exception:
            return None

    def image_analyze(
        self,
        image_path: str,
        prompt: str = "Describe this image in detail",
        detail_level: str = "high",
    ) -> ToolResult:
        """Analyze an image using vision-capable LLM."""
        try:
            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            encoded = self._encode_image(path)
            if not encoded:
                return ToolResult(False, f"Failed to encode image: {image_path}")

            size_info = self._get_image_size(path)

            analysis_prompt = f"""{prompt}

Image Details:
- Path: {path}
- Size: {json.dumps(size_info) if size_info else "Unknown"}
- Detail Level: {detail_level}

Please provide a comprehensive analysis including:
1. Main subject(s) and their positions
2. Colors and visual composition
3. Text or labels present (if any)
4. Notable patterns or features
5. Overall context and setting
6. Any actions or events depicted

Format your analysis in clear sections with bullet points."""

            from tehuti_cli.providers.llm import TehutiLLM

            llm = TehutiLLM(self.config)

            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": analysis_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                        },
                    ],
                }
            ]

            response = llm.chat_messages(messages)

            output = f"## Image Analysis: {path.name}\n\n"
            if size_info:
                output += f"**Dimensions:** {size_info['width']}x{size_info['height']}\n\n"
            output += f"**Prompt:** {prompt}\n\n"
            output += "---\n\n"
            output += response

            return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "Pillow not installed. Install with: pip install Pillow",
            )
        except Exception as exc:
            return ToolResult(False, f"Image analysis failed: {str(exc)}")

    def image_ocr(
        self,
        image_path: str,
        language: str = "eng",
        extract_tables: bool = False,
    ) -> ToolResult:
        """Extract text from images using OCR."""
        try:
            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            if not self._is_tool_available("tesseract"):
                return ToolResult(
                    False,
                    "Tesseract OCR not installed. Install tesseract-ocr for your system.",
                )

            cmd = ["tesseract", str(path), "-"]

            if language != "eng":
                cmd.extend(["-l", language])

            if extract_tables:
                cmd.append("--psm")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )

            if result.returncode == 0:
                output = f"## OCR Results: {path.name}\n\n"
                output += f"**Language:** {language}\n\n"
                output += "---\n\n"
                output += result.stdout

                word_count = len(result.stdout.split())
                output += f"\n\n**Total words extracted:** {word_count}"

                return ToolResult(True, output)
            else:
                return ToolResult(False, f"OCR failed: {result.stderr}")

        except subprocess.TimeoutExpired:
            return ToolResult(False, "OCR timed out after 120 seconds")
        except Exception as exc:
            return ToolResult(False, f"OCR error: {str(exc)}")

    def image_ocr_cloud(
        self,
        image_path: str,
        service: str = "google",
    ) -> ToolResult:
        """Extract text using cloud vision APIs (Google/AWS)."""
        try:
            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            if service == "google":
                return self._google_vision_ocr(path)
            elif service == "aws":
                return self._aws_textract_ocr(path)
            else:
                return ToolResult(False, f"Unknown service: {service}")

        except ImportError as exc:
            return ToolResult(
                False,
                f"Cloud SDK not installed. Install: pip install google-cloud-vision boto3",
            )
        except Exception as exc:
            return ToolResult(False, f"Cloud OCR error: {str(exc)}")

    def _google_vision_ocr(self, path: Path) -> ToolResult:
        """Google Cloud Vision OCR."""
        try:
            from google.cloud import vision

            client = vision.ImageAnnotatorClient()
            with open(path, "rb") as f:
                content = f.read()

            image = vision.Image(content=content)
            response = client.text_detection(image=image)

            if response.error.message:
                return ToolResult(False, f"Google Vision error: {response.error.message}")

            texts = response.text_annotations

            output = f"## Google Vision OCR: {path.name}\n\n"
            output += f"**Service:** Google Cloud Vision\n\n"
            output += "---\n\n"

            if texts:
                full_text = texts[0].description if texts else ""
                output += "### Full Text\n\n"
                output += full_text + "\n\n"

                output += f"### {len(texts) - 1} Additional Text Regions\n\n"
                for i, text in enumerate(texts[1:], 1):
                    output += f"**Region {i}:** {text.description}\n"
                    vertices = [f"({v.x},{v.y})" for v in text.bounding_poly.vertices]
                    output += f"  Bounding: {' -> '.join(vertices)}\n\n"

                return ToolResult(True, output)
            else:
                output += "No text detected in image."
                return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Google Vision error: {str(exc)}")

    def _aws_textract_ocr(self, path: Path) -> ToolResult:
        """AWS Textract OCR."""
        try:
            import boto3

            client = boto3.client("textract")
            with open(path, "rb") as f:
                img_bytes = f.read()

            response = client.detect_document_text(Document={"Bytes": img_bytes})

            output = f"## AWS Textract OCR: {path.name}\n\n"
            output += f"**Service:** Amazon Textract\n\n"
            output += "---\n\n"

            blocks = response.get("Blocks", [])
            text_lines = [b["Text"] for b in blocks if b["BlockType"] == "LINE"]

            full_text = "\n".join(text_lines)
            output += "### Extracted Text\n\n"
            output += full_text

            table_blocks = [b for b in blocks if b["BlockType"] == "TABLE"]
            if table_blocks:
                output += f"\n\n### Tables Detected: {len(table_blocks)}\n"
                for i, table in enumerate(table_blocks, 1):
                    output += f"Table {i}\n"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"AWS Textract error: {str(exc)}")

    def image_screenshot(
        self,
        url: str,
        output_path: str | None = None,
        width: int = 1280,
        height: int = 800,
        wait_for: int = 1000,
        full_page: bool = False,
    ) -> ToolResult:
        """Take a screenshot of a webpage."""
        try:
            from playwright.sync_api import sync_playwright

            if not output_path:
                output_path = self.work_dir / f"screenshot_{int(os.times().ticks)}.png"

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={"width": width, "height": height})

                page.goto(url, wait_until="networkidle")
                page.wait_for_timeout(wait_for)

                if full_page:
                    page.screenshot(path=str(output_path), full_page=True)
                else:
                    page.screenshot(path=str(output_path))

                browser.close()

                return ToolResult(
                    True,
                    f"Screenshot saved to: {output_path}\nURL: {url}\nSize: {width}x{height}",
                )

        except ImportError:
            return ToolResult(
                False,
                "Playwright not installed. Install with: pip install playwright && playwright install",
            )
        except Exception as exc:
            return ToolResult(False, f"Screenshot failed: {str(exc)}")

    def image_describe(
        self,
        image_path: str,
        max_length: int = 200,
    ) -> ToolResult:
        """Generate a concise image description."""
        return self.image_analyze(
            image_path=image_path,
            prompt=f"Provide a concise description in {max_length} characters or less.",
            detail_level="low",
        )

    def image_compare(
        self,
        image1_path: str,
        image2_path: str,
        method: str = "diff",
    ) -> ToolResult:
        """Compare two images for differences."""
        try:
            from PIL import Image, ImageChops, ImageStat

            path1 = Path(image1_path)
            path2 = Path(image2_path)

            if not path1.exists():
                return ToolResult(False, f"Image not found: {image1_path}")
            if not path2.exists():
                return ToolResult(False, f"Image not found: {image2_path}")

            img1 = Image.open(path1)
            img2 = Image.open(path2)

            width1, height1 = img1.size
            width2, height2 = img2.size

            output = f"## Image Comparison: {path1.name} vs {path2.name}\n\n"
            output += f"**Image 1:** {width1}x{height1} pixels\n"
            output += f"**Image 2:** {width2}x{height2} pixels\n\n"

            if (width1, height1) != (width2, height2):
                output += "⚠️ **Images have different dimensions!**\n\n"
                img2 = img2.resize((width1, height1))

            if method == "diff":
                diff_img = ImageChops.difference(img1, img2)
                stat = ImageStat.Stat(diff_img)
                diff_score = sum(stat.mean) / len(stat.mean)
                diff_percent = (diff_score / 255) * 100

                output += f"**Difference Score:** {diff_score:.2f}/255 ({diff_percent:.1f}%)\n\n"

                diff_path = self.work_dir / "diff_visualization.png"
                diff_img.save(diff_path)
                output += f"Difference visualization saved to: {diff_path}\n"

                if diff_percent < 1:
                    output += "\n✅ **Images are nearly identical**"
                elif diff_percent < 10:
                    output += "\n⚡ **Minor differences detected**"
                else:
                    output += "\n🔍 **Significant differences detected**"

            elif method == "histogram":
                hist1 = img1.histogram()
                hist2 = img2.histogram()

                matching = sum(1 for a, b in zip(hist1, hist2) if a == b)
                similarity = (matching / len(hist1)) * 100

                output += f"**Histogram Similarity:** {similarity:.1f}%\n"

            return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "Pillow not installed. Install with: pip install Pillow",
            )
        except Exception as exc:
            return ToolResult(False, f"Image comparison failed: {str(exc)}")

    def image_resize(
        self,
        image_path: str,
        output_path: str,
        width: int | None = None,
        height: int | None = None,
        maintain_ratio: bool = True,
        quality: int = 95,
    ) -> ToolResult:
        """Resize an image."""
        try:
            from PIL import Image

            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            with Image.open(path) as img:
                orig_width, orig_height = img.size

                if maintain_ratio:
                    if width and not height:
                        ratio = width / orig_width
                        height = int(orig_height * ratio)
                    elif height and not width:
                        ratio = height / orig_height
                        width = int(orig_width * ratio)
                    elif not width and not height:
                        return ToolResult(
                            False,
                            "Either width or height must be specified",
                        )

                new_size = (width, height)
                resized = img.resize(new_size, Image.Resampling.LANCZOS)

                output = Path(output_path)
                output.parent.mkdir(parents=True, exist_ok=True)

                img_format = img.format or "PNG"
                resized.save(output_path, quality=quality)

                output_text = f"## Image Resize Complete\n\n"
                output_text += f"**Input:** {path.name} ({orig_width}x{orig_height})\n"
                output_text += f"**Output:** {output_path} ({width}x{height})\n"
                output_text += f"**Format:** {img_format}\n"
                output_text += f"**Quality:** {quality}%\n"

                return ToolResult(True, output_text)

        except ImportError:
            return ToolResult(
                False,
                "Pillow not installed. Install with: pip install Pillow",
            )
        except Exception as exc:
            return ToolResult(False, f"Image resize failed: {str(exc)}")

    def image_convert(
        self,
        image_path: str,
        output_format: str,
        output_path: str | None = None,
        quality: int = 95,
    ) -> ToolResult:
        """Convert image to different format."""
        try:
            from PIL import Image

            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            with Image.open(path) as img:
                format_map = {
                    "jpg": "JPEG",
                    "jpeg": "JPEG",
                    "png": "PNG",
                    "gif": "GIF",
                    "bmp": "BMP",
                    "webp": "WEBP",
                    "tiff": "TIFF",
                    "ico": "ICO",
                }

                target_format = format_map.get(output_format.lower())
                if not target_format:
                    valid = ", ".join(format_map.keys())
                    return ToolResult(
                        False,
                        f"Unsupported format: {output_format}. Valid: {valid}",
                    )

                if not output_path:
                    output_path = str(path.with_suffix(f".{output_format}"))

                output = Path(output_path)
                output.parent.mkdir(parents=True, exist_ok=True)

                if target_format == "JPEG" and img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")

                img.save(output_path, quality=quality)

                output_text = f"## Image Conversion Complete\n\n"
                output_text += f"**Input:** {path.name} ({path.suffix})\n"
                output_text += f"**Output:** {output_path} (.{output_format})\n"
                output_text += f"**Format:** {target_format}\n"

                return ToolResult(True, output_text)

        except ImportError:
            return ToolResult(
                False,
                "Pillow not installed. Install with: pip install Pillow",
            )
        except Exception as exc:
            return ToolResult(False, f"Image conversion failed: {str(exc)}")

    def barcode_detect(
        self,
        image_path: str,
    ) -> ToolResult:
        """Detect and decode barcodes in images."""
        try:
            if not self._is_tool_available("zbarimg"):
                return ToolResult(
                    False,
                    "ZBar not installed. Install: apt install zbar-tools",
                )

            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            result = subprocess.run(
                ["zbarimg", "--quiet", str(path)],
                capture_output=True,
                text=True,
            )

            output = f"## Barcode Detection: {path.name}\n\n"

            if result.stdout:
                barcodes = result.stdout.strip().split("\n")
                output += f"**Barcodes Detected:** {len(barcodes)}\n\n"

                for i, barcode in enumerate(barcodes, 1):
                    if ":" in barcode:
                        fmt, value = barcode.split(":", 1)
                        output += f"### Barcode {i}\n"
                        output += f"**Format:** {fmt}\n"
                        output += f"**Value:** {value}\n\n"
            else:
                output += "No barcodes detected."

            if result.stderr:
                output += f"\n**Warnings:**\n{result.stderr}"

            return ToolResult(True, output)

        except Exception as exc:
            return ToolResult(False, f"Barcode detection failed: {str(exc)}")

    def qrcode_read(
        self,
        image_path: str,
    ) -> ToolResult:
        """Read QR code from image."""
        try:
            from PIL import Image
            from pyzbar.pyzbar import decode

            path = Path(image_path)
            if not path.exists():
                return ToolResult(False, f"Image not found: {image_path}")

            with Image.open(path) as img:
                decoded = decode(img)

            output = f"## QR Code Results: {path.name}\n\n"

            if decoded:
                for i, obj in enumerate(decoded, 1):
                    output += f"### QR Code {i}\n"
                    output += f"**Type:** {obj.type}\n"
                    output += f"**Data:** {obj.data.decode('utf-8')}\n\n"
            else:
                output += "No QR codes detected."

            return ToolResult(True, output)

        except ImportError:
            return ToolResult(
                False,
                "pyzbar not installed. Install: pip install pyzbar",
            )
        except Exception as exc:
            return ToolResult(False, f"QR code reading failed: {str(exc)}")

    def qrcode_generate(
        self,
        data: str,
        output_path: str = "qrcode.png",
        size: int = 10,
        border: int = 4,
    ) -> ToolResult:
        """Generate QR code from data."""
        try:
            from PIL import Image
            from qrcode import QRCode, make

            qr = QRCode(
                version=size,
                error_correction=2,
                box_size=10,
                border=border,
            )
            qr.add_data(data)
            qr.make(fit=True)

            img = qr.make_image(fill_color="black", back_color="white")

            output = Path(output_path)
            output.parent.mkdir(parents=True, exist_ok=True)

            img.save(output_path)

            output_text = f"## QR Code Generated\n\n"
            output_text += f"**Data:** {data}\n"
            output_text += f"**Output:** {output_path}\n"
            output_text += f"**Size:** {size}x{size} modules\n"
            output_text += f"**Border:** {border} modules\n"

            return ToolResult(True, output_text)

        except ImportError:
            return ToolResult(
                False,
                "qrcode not installed. Install: pip install qrcode[pil]",
            )
        except Exception as exc:
            return ToolResult(False, f"QR code generation failed: {str(exc)}")

    def _is_tool_available(self, tool_command: str) -> bool:
        """Check if a command is available."""
        import shutil

        return shutil.which(tool_command) is not None
