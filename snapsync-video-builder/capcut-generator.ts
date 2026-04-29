import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ── Helpers ──────────────────────────────────────────────────────────

function ccUUID(): string {
  return uuidv4().toUpperCase().replace(/-/g, (m, offset) => {
    // CapCut uses mixed-case GUIDs like "58F63C04-3BA4-44be-96B6-E700CCEC3BCB"
    return '-';
  });
}

function secToMicro(sec: number): number {
  return Math.round(sec * 1_000_000);
}

function nowMicro(): number {
  return Date.now() * 1000;
}

// ── Material Factories ──────────────────────────────────────────────

function makeSpeed(id: string) {
  return { curve_speed: null, id, mode: 0, speed: 1.0, type: "speed" };
}

function makeCanvas(id: string) {
  return {
    album_image: "", blur: 0.0, color: "", id, image: "",
    image_id: "", image_name: "", source_platform: 0, team_id: "", type: "canvas_color"
  };
}

function makeSoundChannelMapping(id: string) {
  return { audio_channel_mapping: 0, id, is_config_open: false, type: "" };
}

function makeVocalSeparation(id: string) {
  return {
    choice: 0, enter_from: "", final_algorithm: "", id,
    production_path: "", removed_sounds: [], time_range: null, type: "vocal_separation"
  };
}

function makePlaceholderInfo(id: string) {
  return {
    error_path: "", error_text: "", id, meta_type: "none",
    res_path: "", res_text: "", type: "placeholder_info"
  };
}

function makeMaterialAnimation(id: string) {
  return { animations: [], id, multi_language_current: "none", type: "sticker_animation" };
}

function makeMaterialColor(id: string) {
  return {
    gradient_angle: 90.0, gradient_colors: [], gradient_percents: [],
    height: 0.0, id, is_color_clip: false, is_gradient: false,
    solid_color: "", width: 0.0
  };
}

function makeLoudness(id: string) {
  return {
    enable: false, file_id: "", id, loudness_param: null,
    target_loudness: 0.0, time_range: null
  };
}

function makeVideoMaterial(id: string, filePath: string, w: number, h: number, durationMicro: number) {
  return {
    aigc_history_id: "", aigc_item_id: "", aigc_type: "none", audio_fade: null,
    beauty_body_auto_preset: null, beauty_body_preset_id: "",
    beauty_face_auto_preset: { name: "", preset_id: "", rate_map: "", scene: "" },
    beauty_face_auto_preset_infos: [], beauty_face_preset_infos: [],
    cartoon_path: "", category_id: "", category_name: "local",
    check_flag: 62978047, content_feature_info: null, corner_pin: null,
    crop: {
      lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1,
      upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0
    },
    crop_ratio: "free", crop_scale: 1.0, duration: durationMicro,
    extra_type_option: 0, formula_id: "", freeze: null,
    has_audio: false, has_sound_separated: false,
    height: h, id,
    intensifies_audio_path: "", intensifies_path: "",
    is_ai_generate_content: false, is_copyright: false,
    is_text_edit_overdub: false, is_unified_beauty_mode: false,
    live_photo_cover_path: "", live_photo_timestamp: -1,
    local_id: "", local_material_from: "",
    local_material_id: uuidv4(),
    material_id: "", material_name: path.basename(filePath), material_url: "",
    matting: {
      custom_matting_id: "", enable_matting_stroke: false,
      expansion: 0, feather: 0, flag: 0,
      has_use_quick_brush: false, has_use_quick_eraser: false,
      interactiveTime: [], path: "", reverse: false, strokes: []
    },
    media_path: "", multi_camera_info: null, object_locked: null,
    origin_material_id: "",
    path: filePath.replace(/\\/g, '/'),
    picture_from: "none", picture_set_category_id: "",
    picture_set_category_name: "", request_id: "",
    reverse_intensifies_path: "", reverse_path: "",
    smart_match_info: null, smart_motion: null,
    source: 0, source_platform: 0,
    stable: { matrix_path: "", stable_level: 0, time_range: { duration: 0, start: 0 } },
    team_id: "", type: "photo",
    video_algorithm: {
      ai_background_configs: [], ai_expression_driven: null,
      ai_in_painting_config: [], ai_motion_driven: null,
      aigc_generate: null, aigc_generate_list: [], algorithms: [],
      complement_frame_config: null, deflicker: null,
      gameplay_configs: [], image_interpretation: null,
      motion_blur_config: null, mouth_shape_driver: null,
      noise_reduction: null, path: "", quality_enhance: null,
      skip_algorithm_index: [], smart_complement_frame: null,
      story_video_modify_video_config: {
        is_overwrite_last_video: false, task_id: "", tracker_task_id: ""
      },
      super_resolution: null,
      time_range: { duration: durationMicro, start: 0 }
    },
    video_mask_shadow: {
      alpha: 0, angle: 0, blur: 0, color: "", distance: 0, path: "", resource_id: ""
    },
    video_mask_stroke: {
      alpha: 0, color: "", distance: 0, horizontal_shift: 0,
      path: "", resource_id: "", size: 0, texture: 0, type: "", vertical_shift: 0
    },
    width: w
  };
}

function makeAudioMaterial(id: string, filePath: string, durationMicro: number) {
  return {
    ai_music_generate_scene: 0, ai_music_type: 0,
    aigc_history_id: "", aigc_item_id: "",
    app_id: 0, category_id: "", category_name: "local",
    check_flag: 1, cloned_model_type: "",
    copyright_limit_type: "none", duration: durationMicro,
    effect_id: "", formula_id: "", id,
    intensifies_path: "", is_ai_clone_tone: false,
    is_ai_clone_tone_post: false, is_text_edit_overdub: false,
    is_ugc: false, local_material_id: uuidv4(),
    lyric_type: 0, mock_tone_speaker: "", moyin_emotion: "",
    music_id: uuidv4(), music_source: "",
    name: path.basename(filePath),
    path: filePath.replace(/\\/g, '/'),
    pgc_id: "", pgc_name: "", query: "", request_id: "",
    resource_id: "", search_id: "",
    similiar_music_info: { original_song_id: "", original_song_name: "" },
    sound_separate_type: "", source_from: "",
    source_platform: 0, team_id: "", text_id: "",
    third_resource_id: "", tone_category_id: "",
    tone_category_name: "", tone_effect_id: "",
    tone_effect_name: "", tone_emotion_name_key: "",
    tone_emotion_role: "", tone_emotion_scale: 0,
    tone_emotion_selection: "", tone_emotion_style: "",
    tone_platform: "", tone_second_category_id: "",
    tone_second_category_name: "", tone_speaker: "",
    tone_type: "", tts_generate_scene: "", tts_task_id: "",
    type: "extract_music", video_id: "", wave_points: []
  };
}

function makeSegment(
  materialId: string,
  startMicro: number,
  durationMicro: number,
  extraRefs: string[],
  trackRenderIndex: number,
  isVideo: boolean,
  sourceDuration?: number
) {
  return {
    caption_info: null, cartoon: false,
    clip: isVideo ? {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 }
    } : null,
    color_correct_alg_result: "",
    common_keyframes: [], desc: "",
    digital_human_template_group_id: "",
    enable_adjust: isVideo, enable_adjust_mask: false,
    enable_color_correct_adjust: false, enable_color_curves: true,
    enable_color_match_adjust: false, enable_color_wheels: true,
    enable_hsl: false, enable_hsl_curves: true, enable_lut: isVideo,
    enable_mask_shadow: false, enable_mask_stroke: false,
    enable_smart_color_adjust: false, enable_video_mask: true,
    extra_material_refs: extraRefs,
    group_id: "", hdr_settings: isVideo ? { intensity: 1.0, mode: 1, nits: 1000 } : null,
    id: ccUUID(),
    intensifies_audio: false, is_loop: false,
    is_placeholder: false, is_tone_modify: false,
    keyframe_refs: [], last_nonzero_volume: 1.0,
    lyric_keyframes: null, material_id: materialId,
    raw_segment_id: "", render_index: isVideo ? 0 : 0,
    render_timerange: { duration: 0, start: 0 },
    responsive_layout: {
      enable: false, horizontal_pos_layout: 0,
      size_layout: 0, target_follow: "", vertical_pos_layout: 0
    },
    reverse: false, source: "segmentsourcenormal",
    source_timerange: isVideo
      ? { duration: sourceDuration ?? durationMicro, start: 0 }
      : { duration: sourceDuration ?? durationMicro, start: 0 },
    speed: 1.0, state: 0,
    target_timerange: { duration: durationMicro, start: startMicro },
    template_id: "", template_scene: "default",
    track_attribute: 0, track_render_index: trackRenderIndex,
    uniform_scale: isVideo ? { on: true, value: 1.0 } : null,
    visible: true, volume: 1.0
  };
}

// ── Types ────────────────────────────────────────────────────────────

export interface AlignmentEntry {
  text: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
  imageFileName?: string;
}

export interface CapCutSettings {
  resolution: 'landscape' | 'portrait' | 'square';
  projectName: string;
}

interface ResolutionConfig { width: number; height: number; }

const RES_MAP: Record<string, ResolutionConfig> = {
  landscape: { width: 1920, height: 1080 },
  portrait:  { width: 1080, height: 1920 },
  square:    { width: 1080, height: 1080 },
};

// ── Main Generator ──────────────────────────────────────────────────

export function generateCapCutProject(
  alignment: AlignmentEntry[],
  audioAbsPath: string,
  imageAbsPaths: string[],   // sorted, one per alignment entry
  audioDurationSec: number,
  settings: CapCutSettings,
  capcutProjectsDir: string
): { projectName: string; projectPath: string } {

  const res = RES_MAP[settings.resolution] || RES_MAP.landscape;
  const totalDurationMicro = secToMicro(audioDurationSec);
  const projectName = settings.projectName || `SnapSync_${Date.now()}`;
  const projectDir = path.join(capcutProjectsDir, projectName);

  // Create project directory
  fs.mkdirSync(projectDir, { recursive: true });

  // Copy images into Resources
  const resourcesDir = path.join(projectDir, 'Resources');
  fs.mkdirSync(resourcesDir, { recursive: true });

  const copiedImagePaths: string[] = [];
  for (const imgPath of imageAbsPaths) {
    const dest = path.join(resourcesDir, path.basename(imgPath));
    fs.copyFileSync(imgPath, dest);
    copiedImagePaths.push(dest);
  }

  // Copy audio into Resources
  const audioDest = path.join(resourcesDir, path.basename(audioAbsPath));
  fs.copyFileSync(audioAbsPath, audioDest);

  // ── Build materials arrays ──
  const materials: any = {
    ai_translates: [], audio_balances: [], audio_effects: [],
    audio_fades: [], audio_pannings: [], audio_pitch_shifts: [],
    audio_track_indexes: [], audios: [], beats: [], canvases: [],
    chromas: [], color_curves: [], common_mask: [],
    digital_human_model_dressing: [], digital_humans: [],
    drafts: [], effects: [], flowers: [], green_screens: [],
    handwrites: [], hsl: [], hsl_curves: [], images: [],
    log_color_wheels: [], loudnesses: [], manual_beautys: [],
    manual_deformations: [], material_animations: [],
    material_colors: [], multi_language_refs: [],
    placeholder_infos: [], placeholders: [], plugin_effects: [],
    primary_color_wheels: [], realtime_denoises: [], shapes: [],
    smart_crops: [], smart_relights: [], sound_channel_mappings: [],
    speeds: [], stickers: [], tail_leaders: [], text_templates: [],
    texts: [], time_marks: [], transitions: [], video_effects: [],
    video_radius: [], video_shadows: [], video_strokes: [],
    video_trackings: [], videos: [], vocal_beautifys: [],
    vocal_separations: []
  };

  // ── Build video segments (one per alignment entry) ──
  const videoSegments: any[] = [];

  // Build a basename→path lookup for filename-based image matching
  const imageByBasename = new Map<string, string>();
  for (const p of copiedImagePaths) {
    imageByBasename.set(path.basename(p).toLowerCase(), p);
  }

  for (let i = 0; i < alignment.length; i++) {
    const seg = alignment[i];
    const startMicro = secToMicro(seg.startTime);
    const endMicro = secToMicro(seg.endTime);
    const durMicro = endMicro - startMicro;
    if (durMicro <= 0) continue;

    // Resolve image: prefer filename from CSV, fall back to sequential (with wrap-around)
    let imgPath: string;
    if (seg.imageFileName) {
      imgPath =
        imageByBasename.get(seg.imageFileName.toLowerCase()) ??
        copiedImagePaths[i % copiedImagePaths.length];
    } else {
      imgPath = copiedImagePaths[i % copiedImagePaths.length];
    }
    const videoMatId = ccUUID();
    const speedId = ccUUID();
    const canvasId = ccUUID();
    const channelId = ccUUID();
    const vocalId = ccUUID();
    const placeholderId = ccUUID();
    const animationId = ccUUID();
    const colorId = ccUUID();
    const loudnessId = ccUUID();

    // Create all supporting materials
    materials.videos.push(makeVideoMaterial(videoMatId, imgPath, res.width, res.height, durMicro));
    materials.speeds.push(makeSpeed(speedId));
    materials.canvases.push(makeCanvas(canvasId));
    materials.sound_channel_mappings.push(makeSoundChannelMapping(channelId));
    materials.vocal_separations.push(makeVocalSeparation(vocalId));
    materials.placeholder_infos.push(makePlaceholderInfo(placeholderId));
    materials.material_animations.push(makeMaterialAnimation(animationId));
    materials.material_colors.push(makeMaterialColor(colorId));
    materials.loudnesses.push(makeLoudness(loudnessId));

    const extraRefs = [speedId, placeholderId, canvasId, animationId, channelId, colorId, loudnessId, vocalId];

    videoSegments.push(makeSegment(videoMatId, startMicro, durMicro, extraRefs, 0, true, durMicro));
  }

  // ── Build audio segment ──
  const audioMatId = ccUUID();
  const audioSpeedId = ccUUID();
  const audioChannelId = ccUUID();
  const audioVocalId = ccUUID();
  const audioLoudnessId = ccUUID();
  const audioPlaceholderId = ccUUID();

  materials.audios.push(makeAudioMaterial(audioMatId, audioDest, totalDurationMicro));
  materials.speeds.push(makeSpeed(audioSpeedId));
  materials.sound_channel_mappings.push(makeSoundChannelMapping(audioChannelId));
  materials.vocal_separations.push(makeVocalSeparation(audioVocalId));
  materials.loudnesses.push(makeLoudness(audioLoudnessId));
  materials.placeholder_infos.push(makePlaceholderInfo(audioPlaceholderId));

  const audioExtraRefs = [audioSpeedId, audioPlaceholderId, audioChannelId, audioLoudnessId, audioVocalId];
  const audioSegment = makeSegment(audioMatId, 0, totalDurationMicro, audioExtraRefs, 1, false, totalDurationMicro);

  // ── Build tracks ──
  const tracks = [
    {
      attribute: 0, flag: 0, id: ccUUID(),
      is_default_name: true, name: "",
      segments: videoSegments, type: "video"
    },
    {
      attribute: 0, flag: 0, id: ccUUID(),
      is_default_name: true, name: "",
      segments: [audioSegment], type: "audio"
    }
  ];

  // ── Build draft_content.json ──
  const draftContent: any = {
    canvas_config: {
      background: null, height: res.height, ratio: "original", width: res.width
    },
    color_space: 0, 
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1,
      export_range: null, extract_audio_last_index: 1,
      lyrics_recognition_id: "", lyrics_sync: true, lyrics_taskinfo: [],
      maintrack_adsorb: true, material_save_mode: 0,
      multi_language_current: "none", multi_language_list: [],
      multi_language_main: "none", multi_language_mode: "none",
      original_sound_last_index: 1, record_audio_last_index: 1,
      sticker_max_index: 1, subtitle_keywords_config: null,
      subtitle_recognition_id: "", subtitle_sync: true,
      subtitle_taskinfo: [], system_font_list: [],
      use_float_render: false, video_mute: false, zoom_info_params: null
    },
    cover: null, create_time: 0, draft_type: "video",
    duration: totalDurationMicro, extra_info: null, fps: 30.0,
    free_render_index_mode_on: false,
    function_assistant_info: {
      audio_noise_segid_list: [], auto_adjust: false,
      auto_adjust_fixed: false, auto_adjust_fixed_value: 50.0,
      auto_adjust_segid_list: [], auto_caption: false,
      auto_caption_segid_list: [], auto_caption_template_id: "",
      caption_opt: false, caption_opt_segid_list: [],
      color_correction: false, color_correction_fixed: false,
      color_correction_fixed_value: 50.0, color_correction_segid_list: [],
      deflicker_segid_list: [], enhance_quality: false,
      enhance_quality_fixed: false, enhance_quality_segid_list: [],
      enhance_voice_segid_list: [], enhande_voice: false,
      enhande_voice_fixed: false, eye_correction: false,
      eye_correction_segid_list: [], fixed_rec_applied: false,
      fps: { den: 1, num: 0 }, normalize_loudness: false,
      normalize_loudness_audio_denoise_segid_list: [],
      normalize_loudness_fixed: false, normalize_loudness_segid_list: [],
      retouch: false, retouch_fixed: false, retouch_segid_list: [],
      smart_rec_applied: false, smart_segid_list: [],
      smooth_slow_motion: false, smooth_slow_motion_fixed: false,
      video_noise_segid_list: []
    },
    group_container: null, id: ccUUID(),
    is_drop_frame_timecode: false, keyframe_graph_list: [],
    keyframes: {
      adjusts: [], audios: [], effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: []
    },
    last_modified_platform: {
      app_id: 359289, app_source: "cc", app_version: "8.3.0",
      device_id: "", hard_disk_id: "", mac_address: "",
      os: "windows", os_version: "10.0.19045"
    },
    lyrics_effects: [], materials,
    mutable_config: null, name: "",
    new_version: "153.0.0", path: "",
    platform: {
      app_id: 359289, app_source: "cc", app_version: "8.3.0",
      device_id: "", hard_disk_id: "", mac_address: "",
      os: "windows", os_version: "10.0.19045"
    },
    relationships: [], render_index_track_mode_on: true,
    retouch_cover: null,
    smart_ads_info: { draft_url: "", page_from: "", routine: "" },
    source: "default", static_cover_image_path: "",
    time_marks: null, tracks,
    uneven_animation_template_info: {
      composition: "", content: "", order: "", sub_template_info_list: []
    },
    update_time: 0, version: 360000
  };

  // ── Build draft_meta_info.json ──
  const now = nowMicro();
  const draftMetaInfo = {
    cloud_draft_cover: true, cloud_draft_sync: true,
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: "",
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "draft_cover.jpg",
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "", draft_enterprise_id: "",
      draft_enterprise_name: "", enterprise_material: []
    },
    draft_fold_path: projectDir.replace(/\\/g, '/'),
    draft_id: ccUUID(),
    draft_is_ae_produce: false, draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false, draft_is_ai_translate: false,
    draft_is_article_video_draft: false, draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: "false", draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] }, { type: 1, value: [] },
      { type: 2, value: [] }, { type: 3, value: [] },
      { type: 6, value: [] }, { type: 7, value: [] },
      { type: 8, value: [] }
    ],
    draft_materials_copied_info: [],
    draft_name: projectName,
    draft_need_rename_folder: false, draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: capcutProjectsDir.replace(/\\/g, '\\\\'),
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: "", draft_web_article_video_enter_from: "",
    tm_draft_cloud_completed: "", tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1,
    tm_draft_create: now, tm_draft_modified: now,
    tm_draft_removed: 0, tm_duration: totalDurationMicro
  };

  // ── Write files ──
  const contentJson = JSON.stringify(draftContent);
  fs.writeFileSync(path.join(projectDir, 'draft_content.json'), contentJson);
  fs.writeFileSync(path.join(projectDir, 'draft_content.json.bak'), contentJson);
  fs.writeFileSync(path.join(projectDir, 'draft_meta_info.json'), JSON.stringify(draftMetaInfo));

  // Create minimal other files CapCut expects
  fs.writeFileSync(path.join(projectDir, 'draft_settings'), JSON.stringify({ id: ccUUID() }));
  fs.writeFileSync(path.join(projectDir, 'draft.extra'), JSON.stringify({ is_from_lens: false }));

  return { projectName, projectPath: projectDir };
}
