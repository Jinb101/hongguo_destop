"""Single-episode media metadata for the desktop playback pipeline."""
import base64
import binascii
import json
import re


def parse_video_model(response):
    """Decode metadata envelopes without selecting or lowering video quality."""
    if not isinstance(response, dict) or type(response.get("code")) is not int or response["code"] != 0:
        raise ValueError("Episode media request was not successful")
    data = response.get("data")
    if not isinstance(data, dict):
        raise ValueError("Episode media metadata unavailable")
    model = data.get("video_model")
    if model is None or model == "" or model == {}:
        # Retain duration/encryption/codec fields alongside flattened tracks.
        model = dict(data)
    if isinstance(model, str):
        if len(model) > 4 * 1024 * 1024:
            raise ValueError("Episode media metadata too large")
        try:
            model = json.loads(model)
        except ValueError:
            try:
                encoded = model.encode("ascii")
                decoded = base64.b64decode(encoded + b"=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
                model = json.loads(decoded.decode("utf-8"))
            except (ValueError, UnicodeError, binascii.Error):
                raise ValueError("Invalid episode media metadata") from None
    if not isinstance(model, dict) or not isinstance(model.get("video_list"), (dict, list)) or not model["video_list"]:
        raise ValueError("Episode media metadata unavailable")
    return model


def get_video_model(api, video_id):
    video_id = str(video_id)
    if not re.fullmatch(r"[0-9]{8,24}", video_id):
        raise ValueError("Invalid episode media identity")
    response = api(
        "POST", "/novel/player/video_model/v1/",
        body={"video_id": video_id, "content_type": 1,
              "biz_param": {"need_all_video_definition": True, "video_platform": 3}},
        max_retries=1,
    )
    # Authentication/rate-limit errors propagate from the existing API client.
    # Do not try another identity, strip authorization, or use another provider.
    return parse_video_model(response)
