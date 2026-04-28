import logging
import re
import requests
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)

CMIS_BROWSER_BASE = "/alfresco/api/-default-/public/cmis/versions/1.1/browser"

ALF_USER = "alfodoo"
ALF_PASS = "alfodoo"

class CmisProxy(http.Controller):

    @http.route([
        "/cmis/proxy", "/cmis/proxy/",
        "/cmis/proxy/<path:subpath>", "/cmis/proxy<path:subpath>",
    ], type="http", auth="user", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], csrf=False)
    def cmis_proxy(self, subpath=None, **kwargs):
        alf_user = request.session.get("alf_user")
        alf_pass = request.session.get("alf_pass")
        if not alf_user or not alf_pass:
            return request.make_response("Alfresco credentials required", status=401)

        if subpath and not subpath.startswith("/"):
            subpath = "/" + subpath
        if subpath and subpath.startswith("/"):
            subpath = subpath[1:]

        base_url = request.env["ir.config_parameter"].sudo().get_param("web.base.url")
        cmis_backend = request.env["cmis.backend"].sudo().search([], limit=1)
        target_url = cmis_backend.location
        if subpath:
            target_url = target_url.rstrip("/") + "/" + subpath

        if request.httprequest.method == "OPTIONS":
            resp = request.make_response("", status=204)
            origin = request.httprequest.headers.get("Origin")
            if origin:
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = request.httprequest.headers.get(
                "Access-Control-Request-Headers", "Authorization,Content-Type"
            )
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            return resp

        method = request.httprequest.method
        params = request.httprequest.args.to_dict(flat=True)

        # Seulement pour les GET "simples"
        if method == "GET" and not params:
            params = {"cmisselector": "repositoryInfo"}

        headers = {
            "Accept": request.httprequest.headers.get("Accept", "application/json"),
        }

        content_type = request.httprequest.headers.get("Content-Type", "")
        is_multipart = content_type.startswith("multipart/form-data")

        try:
            if is_multipart:
                # Champs de formulaire multipart
                form_data = []
                for key in request.httprequest.form:
                    for value in request.httprequest.form.getlist(key):
                        form_data.append((key, value))

                # Fichiers multipart
                files = []
                for key, storage in request.httprequest.files.items(multi=True):
                    files.append(
                        (
                            key,
                            (
                                storage.filename,
                                storage.stream.read(),
                                storage.mimetype or "application/octet-stream",
                            ),
                        )
                    )

                # IMPORTANT: ne pas fixer Content-Type à la main
                # requests le reconstruit avec le bon boundary
                r = requests.request(
                    method=method,
                    url=target_url,
                    headers=headers,
                    params=params,
                    data=form_data,
                    files=files,
                    auth=(alf_user, alf_pass),
                    timeout=60,
                )
            else:
                raw_data = request.httprequest.get_data()

                if content_type:
                    headers["Content-Type"] = content_type

                r = requests.request(
                    method=method,
                    url=target_url,
                    headers=headers,
                    params=params,
                    data=raw_data,
                    auth=(alf_user, alf_pass),
                    timeout=60,
                )

            response_content_type = r.headers.get("Content-Type", "")
            body = r.content

            if "json" in response_content_type.lower():
                try:
                    text = body.decode("utf-8", errors="replace")
                    alf_unescaped = target_url
                    alf_escaped = target_url.replace("/", "\\/")
                    text = re.sub(re.escape(alf_unescaped) + r"(\/)?", r"/cmis/proxy\1", text)
                    text = re.sub(re.escape(alf_escaped) + r"(\\\/)?", r"\/cmis\/proxy\1", text)
                    body = text.encode("utf-8")
                except Exception:
                    pass

            resp = request.make_response(body, status=r.status_code)
            resp.headers["Content-Type"] = response_content_type or "application/json"
            return resp

        except requests.RequestException:
            return request.make_response("Bad Gateway", status=502)

    @http.route("/cmis/set_credentials", type="json", auth="user", methods=["POST"])
    def set_credentials(self, username, password):
        cmis_backend = request.env['cmis.backend'].sudo().search([], limit=1)
        target_url = cmis_backend.location
        r = requests.get(target_url, params={"cmisselector": "repositoryInfo"}, auth=(username, password), timeout=20)
        if r.status_code >= 400:
            return {"ok": False, "status": r.status_code}

        request.session["alf_user"] = username
        request.session["alf_pass"] = password
        return {"ok": True}

    @http.route("/cmis/logout", type="json", auth="user", methods=["POST"])
    def cmis_logout(self):
        request.session.pop("alf_user", None)
        request.session.pop("alf_pass", None)
        return {"ok": True}

    @http.route("/cmis/session_info", type="json", auth="user")
    def cmis_session_info(self):
        return {
            "alf_user": request.session.get("alf_user"),
        }
