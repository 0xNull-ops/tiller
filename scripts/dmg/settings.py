"""dmgbuild writes .DS_Store directly; no Finder or Apple Events required."""
import os
app = defines['app']
artwork = defines['artwork']
files = [app]
symlinks = {'Applications': '/Applications'}
icon = defines['icon']
background = os.path.join(artwork, 'background.tiff')
window_rect = ((200, 200), (640, 420))
icon_locations = {'Tiller.app': (180, 230), 'Applications': (460, 230)}
icon_size = 96
text_size = 13
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
sidebar_width = 0
default_view = 'icon-view'
include_icon_view_settings = True
include_list_view_settings = False
arrange_by = None
