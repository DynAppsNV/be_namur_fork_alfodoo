# © 2016 ACSONE SA/NV (<http://acsone.eu>)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html).

from odoo import api, models


class CmisBackend(models.Model):
    _inherit = "cmis.backend"

    def _get_current_backend(self):
        return self.search([], limit=1)

    @api.model
    def get_cmis_repository_from_js(self):
        """Return the default repository in the CMIS container"""
        backend = self._get_current_backend()
        cmis_container = self._get_web_description(backend)
        return cmis_container
