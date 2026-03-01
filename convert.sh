ffmpeg -hide_banner -y -i $1 \
    -filter_complex "\
        [0:v]split=3[v1080][v720][v480]; \
        [v1080]scale=w=1920:h=1080:force_original_aspect_ratio=decrease[v1080s]; \
        [v720] scale=w=1280:h=720: force_original_aspect_ratio=decrease[v720s];  \
        [v480] scale=w=-2:h=480[v480s]   \
    " \
    \
    -map "[v1080s]" -map 0:a:0? \
        -c:v:0 libx264 -preset veryfast -crf:0 20 -profile:v:0 high -level:v:0 4.1 \
        -pix_fmt:v:0 yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
        -c:a:0 aac -b:a:0 192k -ac:a:0 2 -ar:a:0 48000 \
    \
    -map "[v720s]" -map 0:a:0? \
        -c:v:1 libx264 -preset veryfast -crf:1 22 -profile:v:1 high -level:v:1 4.0 \
        -pix_fmt:v:1 yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
        -c:a:1 aac -b:a:1 160k -ac:a:1 2 -ar:a:1 48000 \
    \
    -map "[v480s]" -map 0:a:0? \
        -c:v:2 libx264 -preset veryfast -crf:2 24 -profile:v:2 high -level:v:2 3.1 \
        -pix_fmt:v:2 yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
        -c:a:2 aac -b:a:2 128k -ac:a:2 2 -ar:a:2 48000 \
    \
    -f hls \
    -hls_time 6 -hls_playlist_type vod \
    -hls_flags independent_segments \
    -hls_segment_type mpegts \
    -master_pl_name master.m3u8 \
    -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
    -hls_segment_filename "out/v%v/seg_%05d.ts" \
    out/v%v/index.m3u8
