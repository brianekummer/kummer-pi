#!/bin/bash
# Return the latest version of NextCloud for my release channel
# Based on work from https://spielwiese.la-evento.com/xelasblog/archives/75-Mailbenachrichtigung-bei-verfuegbaren-Nextcloud-Updates.html

VERSION_FILE=/var/www/nextcloud/version.php
CONFIG_FILE=/var/www/nextcloud/config/config.php
URL_BASE='https://updates.nextcloud.org/updater_server/?version='

RELEASE_CHANNEL=$(grep 'updater.release.channel' $CONFIG_FILE | cut -d "'" -f 4)
PHP=$(php -v | grep -v '(c)' | cut -d ' ' -f 2 | sed -e 's/-.*//g' -e 's/\./x/g')
VERSION=$(grep 'OC_Version =' $VERSION_FILE | cut -d '(' -f 2 | cut -d ')' -f 1)
CURRENT_VERSION=$(echo $VERSION | sed -e 's/,/./g')
VERSION_URL=$(echo $VERSION | sed -e 's/,/x/g')
BUILD_RAW=$(grep OC_Build $VERSION_FILE | cut -d "'" -f 2)
BUILD_ENCODED=$(php -r "print urlencode(\"$BUILD_RAW\");";)

URL=${URL_BASE}${VERSION_URL}xxx${RELEASE_CHANNEL}xx${BUILD_ENCODED}x${PHP}

NEW_VERSION=$(curl -s -A 'Nextcloud updater' $URL | grep 'version>' | sed -e 's/version//g' -e 's/[<>/]//g')
if [ "$NEW_VERSION" ]
then
  echo $NEW_VERSION
else
  echo $CURRENT_VERSION
fi
exit 0
