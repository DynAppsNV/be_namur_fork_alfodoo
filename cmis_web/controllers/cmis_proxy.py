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
        "/cmis/proxy","/cmis/proxy/",
        "/cmis/proxy/<path:subpath>", "/cmis/proxy<path:subpath>"
    ], type="http", auth="user",
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], csrf=False)
    def cmis_proxy(self, subpath=None, **kwargs):
        """
        User proxy to avoid CORS error from call Alfresco with Javascript
        :param subpath: path after main location for Alfresco API
        :param kwargs:
        :return:
        """
        alf_user = request.session.get("alf_user")
        alf_pass = request.session.get("alf_pass")
        if not alf_user or not alf_pass:
            return request.make_response("Alfresco credentials required", status=401)
        if subpath and not subpath.startswith("/"):
            subpath = "/" + subpath
        if subpath and subpath.startswith("/"):
            subpath = subpath[1:]
        base_url = request.env['ir.config_parameter'].sudo().get_param('web.base.url')
        cmis_backend = request.env['cmis.backend'].sudo().search([], limit=1)
        target_url = cmis_backend.location
        # Strip subpath
        if subpath:
            target_url = target_url.rstrip("/") + "/" + subpath

        # TODO: Check if some http call are 'OPTIONS' or not
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

        # Necessary Headers
        params = request.httprequest.args.to_dict(flat=True)
        data = request.httprequest.get_data()
        if not params:
            params = {"cmisselector": "repositoryInfo"}
        headers = {
            "Accept": request.httprequest.headers.get("Accept", "application/json"),
            "Access-Control-Allow-Origin": base_url
        }
        ct = request.httprequest.headers.get("Content-Type")
        if ct:
            headers["Content-Type"] = ct

        # Try main Call
        try:
            r = requests.request(
                method=request.httprequest.method,
                url=target_url,
                headers=headers,
                params=params,
                data=data,
                auth=(alf_user, alf_pass),
                timeout=60,
            )
            content_type = r.headers.get("Content-Type", "")
            body = r.content

            if "json" in content_type.lower():
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
            resp.headers["Content-Type"] = content_type or "application/json"
            return resp

        except requests.RequestException:
            _logger.exception("CMIS proxy failed calling %s", target_url)
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
