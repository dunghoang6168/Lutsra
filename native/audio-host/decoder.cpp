#include "audio_host.h"
#include <algorithm>
#include <chrono>
#include <vector>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
}

static std::string utf8(const std::wstring &value) {
  if (value.empty())
    return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(),
                                       static_cast<int>(value.size()), nullptr,
                                       0, nullptr, nullptr);
  std::string out(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                      out.data(), size, nullptr, nullptr);
  return out;
}

DecoderPipeline::DecoderPipeline() = default;
DecoderPipeline::~DecoderPipeline() { stop(); }

bool DecoderPipeline::open(const std::wstring &path, int outputRate,
                           int outputChannels, std::string &error) {
  return open(path, outputRate, outputChannels, 0.0, error);
}

bool DecoderPipeline::open(const std::wstring &path, int outputRate,
                           int outputChannels, double startSeconds,
                           std::string &error) {
  stop();
  path_ = path;
  outputRate_ = outputRate;
  outputChannels_ = outputChannels;
  stopping_ = false;
  ended_ = false;
  failed_ = false;
  pendingSeek_ = std::max(0.0, startSeconds);
  // TODO: retain the probed input to avoid reopening the same file in decodeLoop.
  AVFormatContext *format = nullptr;
  const auto input = utf8(path);
  if (avformat_open_input(&format, input.c_str(), nullptr, nullptr) < 0 ||
      avformat_find_stream_info(format, nullptr) < 0) {
    if (format)
      avformat_close_input(&format);
    error = "MEDIA_DECODE";
    return false;
  }
  const int stream =
      av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
  if (stream < 0) {
    avformat_close_input(&format);
    error = "MEDIA_UNSUPPORTED";
    return false;
  }
  auto *params = format->streams[stream]->codecpar;
  source_ = {params->sample_rate,
             params->bits_per_raw_sample ? params->bits_per_raw_sample
                                         : params->bits_per_coded_sample,
             params->ch_layout.nb_channels};
  duration_ = format->duration > 0
                  ? static_cast<double>(format->duration) / AV_TIME_BASE
                  : 0;
  avformat_close_input(&format);
  worker_ = std::thread(&DecoderPipeline::decodeLoop, this);
  return true;
}
void DecoderPipeline::stop() {
  stopping_ = true;
  wakeCondition_.notify_all();
  if (worker_.joinable())
    worker_.join();
  ring_.clear();
}
void DecoderPipeline::seek(double seconds) {
  pendingSeek_ = std::max(0.0, seconds);
  ended_ = false;
  failed_ = false;
  ring_.clear();
  wakeCondition_.notify_all();
}

void DecoderPipeline::decodeLoop() {
  AVFormatContext *format = nullptr;
  AVCodecContext *codec = nullptr;
  SwrContext *swr = nullptr;
  AVPacket *packet = nullptr;
  AVFrame *frame = nullptr;
  const auto input = utf8(path_);
  if (avformat_open_input(&format, input.c_str(), nullptr, nullptr) < 0 ||
      avformat_find_stream_info(format, nullptr) < 0)
    goto cleanup;
  {
    const int streamIndex =
        av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
    if (streamIndex < 0)
      goto cleanup;
    const AVCodec *decoder =
        avcodec_find_decoder(format->streams[streamIndex]->codecpar->codec_id);
    if (!decoder)
      goto cleanup;
    codec = avcodec_alloc_context3(decoder);
    if (!codec ||
        avcodec_parameters_to_context(
            codec, format->streams[streamIndex]->codecpar) < 0 ||
        avcodec_open2(codec, decoder, nullptr) < 0)
      goto cleanup;
    AVChannelLayout outputLayout{};
    av_channel_layout_default(&outputLayout, outputChannels_);
    if (swr_alloc_set_opts2(&swr, &outputLayout, AV_SAMPLE_FMT_FLT, outputRate_,
                            &codec->ch_layout, codec->sample_fmt,
                            codec->sample_rate, 0, nullptr) < 0 ||
        swr_init(swr) < 0) {
      av_channel_layout_uninit(&outputLayout);
      goto cleanup;
    }
    av_channel_layout_uninit(&outputLayout);
    packet = av_packet_alloc();
    frame = av_frame_alloc();
    if (!packet || !frame)
      goto cleanup;
    std::vector<float> converted;
    const auto writeConverted = [&](size_t count) {
      size_t offset = 0;
      while (!stopping_ && pendingSeek_.load() < 0 && offset < count) {
        offset += ring_.write(converted.data() + offset, count - offset);
        if (offset < count) {
          std::unique_lock wakeLock(wakeMutex_);
          wakeCondition_.wait_for(wakeLock, std::chrono::milliseconds(2), [this] {
            return stopping_.load() || pendingSeek_.load() >= 0;
          });
        }
      }
    };
    bool draining = false;
    while (!stopping_) {
      const double requested = pendingSeek_.exchange(-1);
      if (requested >= 0) {
        const int64_t timestamp = av_rescale_q(
            static_cast<int64_t>(requested * AV_TIME_BASE), AV_TIME_BASE_Q,
            format->streams[streamIndex]->time_base);
        if (av_seek_frame(format, streamIndex, timestamp,
                          AVSEEK_FLAG_BACKWARD) < 0) {
          failed_ = true;
          ended_ = true;
          continue;
        }
        avcodec_flush_buffers(codec);
        swr_close(swr);
        if (swr_init(swr) < 0) {
          failed_ = true;
          ended_ = true;
          continue;
        }
        ring_.clear();
        draining = false;
        ended_ = false;
        failed_ = false;
      }
      if (ended_) {
        std::unique_lock wakeLock(wakeMutex_);
        wakeCondition_.wait(wakeLock, [this] {
          return stopping_.load() || pendingSeek_.load() >= 0;
        });
        continue;
      }
      const int readResult = av_read_frame(format, packet);
      if (readResult < 0) {
        if (readResult != AVERROR_EOF) {
          failed_ = true;
          ended_ = true;
          continue;
        }
        if (!draining) {
          avcodec_send_packet(codec, nullptr);
          draining = true;
        }
      } else if (packet->stream_index != streamIndex) {
        av_packet_unref(packet);
        continue;
      } else {
        if (avcodec_send_packet(codec, packet) < 0) {
          av_packet_unref(packet);
          continue;
        }
        av_packet_unref(packet);
      }
      bool gotFrame = false;
      while (!stopping_ && avcodec_receive_frame(codec, frame) == 0) {
        gotFrame = true;
        const int maximum = swr_get_out_samples(swr, frame->nb_samples);
        converted.resize(static_cast<size_t>(maximum) * outputChannels_);
        uint8_t *output[] = {reinterpret_cast<uint8_t *>(converted.data())};
        const int frames =
            swr_convert(swr, output, maximum,
                        const_cast<const uint8_t **>(frame->extended_data),
                        frame->nb_samples);
        writeConverted(static_cast<size_t>(std::max(0, frames)) *
                       outputChannels_);
        av_frame_unref(frame);
      }
      if (draining && !gotFrame) {
        converted.resize(static_cast<size_t>(4096) * outputChannels_);
        uint8_t *output[] = {reinterpret_cast<uint8_t *>(converted.data())};
        while (!stopping_ && pendingSeek_.load() < 0) {
          const int frames = swr_convert(swr, output, 4096, nullptr, 0);
          if (frames < 0) {
            failed_ = true;
            break;
          }
          if (frames == 0)
            break;
          writeConverted(static_cast<size_t>(frames) * outputChannels_);
        }
        ended_ = true;
        draining = false;
      }
    }
  }
cleanup:
  if (!stopping_)
    failed_ = true;
  ended_ = !stopping_;
  if (frame)
    av_frame_free(&frame);
  if (packet)
    av_packet_free(&packet);
  if (swr)
    swr_free(&swr);
  if (codec)
    avcodec_free_context(&codec);
  if (format)
    avformat_close_input(&format);
}
